//! Bounded, opportunistic console-injection capture. A fallback always retains
//! the original wire bytes so the caller can relay the response without changing
//! its framing. This module does not impose a limit on the relayed page itself.

use std::io::{self, Read};
use std::time::{Duration, Instant};

const CAPTURE_BUDGET: Duration = Duration::from_millis(250);
const READ_CHUNK: usize = 8192;
const MAX_CHUNK_LINE: usize = 8192;
const MAX_TRAILERS: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PreviewBodyCapture {
    Complete(Vec<u8>),
    Passthrough(Vec<u8>),
}

#[derive(Clone, Copy, Debug)]
pub(super) enum PreviewBodyFraming {
    Length(usize),
    Chunked,
    CloseDelimited,
}

/// Capture only small, promptly completed bodies. A socket read must also have
/// a short timeout: the elapsed-time check cannot interrupt a blocking Read.
pub(super) fn capture_preview_body<R: Read>(
    remote: &mut R,
    first_body: &[u8],
    framing: PreviewBodyFraming,
    limit: usize,
) -> io::Result<PreviewBodyCapture> {
    if let PreviewBodyFraming::Length(length) = framing {
        if length > limit {
            return Ok(PreviewBodyCapture::Passthrough(first_body.to_vec()));
        }
        if first_body.len() >= length {
            return Ok(PreviewBodyCapture::Complete(first_body[..length].to_vec()));
        }
    }
    // Header reads can already contain a body prefix. Never discard any of it
    // on fallback, including when a caller supplies a cap smaller than that read.
    if first_body.len() > limit {
        return Ok(PreviewBodyCapture::Passthrough(first_body.to_vec()));
    }
    let started = Instant::now();
    let mut body = first_body.to_vec();
    let mut chunks = ChunkedBodyState::default();
    let mut buffer = [0_u8; READ_CHUNK];
    loop {
        match framing {
            PreviewBodyFraming::Length(length) if body.len() == length => {
                return Ok(PreviewBodyCapture::Complete(body));
            }
            PreviewBodyFraming::Chunked => {
                match chunks.advance(&body) {
                    Ok(Some(end)) => {
                        return Ok(PreviewBodyCapture::Complete(decode_validated_chunks(
                            body, end,
                        )));
                    }
                    Ok(None) => {}
                    // Optional inspection must not reject valid pages with very
                    // large extensions or trailers. Relay their untouched bytes.
                    Err(ChunkError::CaptureLimit) => {
                        return Ok(PreviewBodyCapture::Passthrough(body));
                    }
                    Err(ChunkError::Invalid(error)) => return Err(error),
                }
            }
            _ => {}
        }
        if body.len() >= limit || started.elapsed() >= CAPTURE_BUDGET {
            return Ok(PreviewBodyCapture::Passthrough(body));
        }
        let mut wanted = READ_CHUNK.min(limit - body.len());
        if let PreviewBodyFraming::Length(length) = framing {
            wanted = wanted.min(length - body.len());
        }
        match remote.read(&mut buffer[..wanted]) {
            Ok(0) => {
                return match framing {
                    PreviewBodyFraming::CloseDelimited => Ok(PreviewBodyCapture::Complete(body)),
                    _ => Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "incomplete preview response body",
                    )),
                };
            }
            Ok(read) => {
                // Grow geometrically without reserving beyond the capture cap.
                // Small pages do not eagerly allocate the entire maximum budget.
                let required = body.len() + read;
                if required > body.capacity() {
                    let capacity = body.capacity().saturating_mul(2).max(required).min(limit);
                    body.reserve_exact(capacity - body.len());
                }
                body.extend_from_slice(&buffer[..read]);
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
                ) =>
            {
                return Ok(PreviewBodyCapture::Passthrough(body));
            }
            Err(error) => return Err(error),
        }
    }
}

#[derive(Default)]
enum ChunkPhase {
    #[default]
    Size,
    Data(usize),
    DataCrlf,
    Trailers,
    Complete,
}

#[derive(Default)]
struct ChunkedBodyState {
    phase: ChunkPhase,
    position: usize,
    line_scan: usize,
    trailer_start: usize,
}

#[derive(Debug)]
enum ChunkError {
    CaptureLimit,
    Invalid(io::Error),
}

impl From<io::Error> for ChunkError {
    fn from(error: io::Error) -> Self {
        Self::Invalid(error)
    }
}

impl ChunkedBodyState {
    fn advance(&mut self, bytes: &[u8]) -> Result<Option<usize>, ChunkError> {
        loop {
            match self.phase {
                ChunkPhase::Size => {
                    let Some(end) = self.line_end(bytes)? else {
                        return Ok(None);
                    };
                    let size = parse_chunk_size(&bytes[self.position..end])?;
                    self.position = end + 2;
                    self.line_scan = self.position;
                    self.phase = if size == 0 {
                        self.trailer_start = self.position;
                        ChunkPhase::Trailers
                    } else {
                        ChunkPhase::Data(size)
                    };
                }
                ChunkPhase::Data(remaining) => {
                    let consumed = remaining.min(bytes.len() - self.position);
                    self.position += consumed;
                    if consumed < remaining {
                        self.phase = ChunkPhase::Data(remaining - consumed);
                        return Ok(None);
                    }
                    self.phase = ChunkPhase::DataCrlf;
                }
                ChunkPhase::DataCrlf => {
                    let available = &bytes[self.position..];
                    if available.first().is_some_and(|byte| *byte != b'\r') {
                        return Err(invalid_chunk("invalid chunk data terminator").into());
                    }
                    if available.len() < 2 {
                        return Ok(None);
                    }
                    if available[1] != b'\n' {
                        return Err(invalid_chunk("invalid chunk data terminator").into());
                    }
                    self.position += 2;
                    self.line_scan = self.position;
                    self.phase = ChunkPhase::Size;
                }
                ChunkPhase::Trailers => {
                    let Some(end) = self.line_end(bytes)? else {
                        if bytes.len() - self.trailer_start > MAX_TRAILERS {
                            return Err(ChunkError::CaptureLimit);
                        }
                        return Ok(None);
                    };
                    if end + 2 - self.trailer_start > MAX_TRAILERS {
                        return Err(ChunkError::CaptureLimit);
                    }
                    let empty = end == self.position;
                    self.position = end + 2;
                    self.line_scan = self.position;
                    if empty {
                        self.phase = ChunkPhase::Complete;
                    }
                }
                ChunkPhase::Complete => return Ok(Some(self.position)),
            }
        }
    }

    fn line_end(&mut self, bytes: &[u8]) -> Result<Option<usize>, ChunkError> {
        if let Some(relative) = bytes[self.line_scan..]
            .windows(2)
            .position(|pair| pair == b"\r\n")
        {
            let end = self.line_scan + relative;
            if end + 2 - self.position > MAX_CHUNK_LINE {
                return Err(ChunkError::CaptureLimit);
            }
            return Ok(Some(end));
        }
        if bytes.len() - self.position >= MAX_CHUNK_LINE {
            return Err(ChunkError::CaptureLimit);
        }
        // The next read may complete a CRLF split across the read boundary.
        self.line_scan = bytes.len().saturating_sub(1).max(self.position);
        Ok(None)
    }
}

fn parse_chunk_size(line: &[u8]) -> io::Result<usize> {
    let mut size = line.split(|byte| *byte == b';').next().unwrap_or_default();
    // Keep the prior decoder's tolerance for optional surrounding whitespace.
    while size.first().is_some_and(u8::is_ascii_whitespace) {
        size = &size[1..];
    }
    while size.last().is_some_and(u8::is_ascii_whitespace) {
        size = &size[..size.len() - 1];
    }
    if size.is_empty() {
        return Err(invalid_chunk("invalid chunk size"));
    }
    let mut value = 0_usize;
    for byte in size {
        let digit = match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            b'A'..=b'F' => byte - b'A' + 10,
            _ => return Err(invalid_chunk("invalid chunk size")),
        };
        value = value
            .checked_mul(16)
            .and_then(|number| number.checked_add(usize::from(digit)))
            .ok_or_else(|| invalid_chunk("chunk size overflow"))?;
    }
    Ok(value)
}

fn invalid_chunk(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// Called only after the incremental parser has validated every byte boundary.
/// Compact in place rather than retaining separate raw and decoded allocations.
fn decode_validated_chunks(mut bytes: Vec<u8>, end: usize) -> Vec<u8> {
    let mut source = 0;
    let mut destination = 0;
    while source < end {
        let line_end = source
            + bytes[source..end]
                .windows(2)
                .position(|pair| pair == b"\r\n")
                .expect("validated chunk size line");
        let size = parse_chunk_size(&bytes[source..line_end]).expect("validated chunk size");
        if size == 0 {
            break;
        }
        source = line_end + 2;
        bytes.copy_within(source..source + size, destination);
        destination += size;
        source += size + 2;
    }
    bytes.truncate(destination);
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct Fragmented<'a> {
        bytes: &'a [u8],
        max_read: usize,
        eof_allowed: bool,
    }

    impl Read for Fragmented<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            assert!(
                self.eof_allowed || !self.bytes.is_empty(),
                "unexpected EOF read"
            );
            let count = self.bytes.len().min(buffer.len()).min(self.max_read);
            buffer[..count].copy_from_slice(&self.bytes[..count]);
            self.bytes = &self.bytes[count..];
            Ok(count)
        }
    }

    struct NoRead;

    impl Read for NoRead {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            panic!("capture should not read from the target");
        }
    }

    #[test]
    fn fixed_length_stops_exactly_and_large_declarations_do_not_read() {
        for split in 0..=5 {
            let mut reader = Fragmented {
                bytes: &b"hello"[split..],
                max_read: 1,
                eof_allowed: false,
            };
            assert_eq!(
                capture_preview_body(
                    &mut reader,
                    &b"hello"[..split],
                    PreviewBodyFraming::Length(5),
                    5
                )
                .unwrap(),
                PreviewBodyCapture::Complete(b"hello".to_vec())
            );
        }
        assert_eq!(
            capture_preview_body(
                &mut NoRead,
                b"prefix",
                PreviewBodyFraming::Length(usize::MAX),
                5
            )
            .unwrap(),
            PreviewBodyCapture::Passthrough(b"prefix".to_vec())
        );
        assert_eq!(
            capture_preview_body(
                &mut NoRead,
                b"hello excess",
                PreviewBodyFraming::Length(5),
                5
            )
            .unwrap(),
            PreviewBodyCapture::Complete(b"hello".to_vec())
        );
        assert_eq!(
            capture_preview_body(&mut NoRead, b"", PreviewBodyFraming::Length(0), 0).unwrap(),
            PreviewBodyCapture::Complete(Vec::new())
        );
    }

    #[test]
    fn chunk_boundaries_extensions_and_trailers_complete_without_eof() {
        let wire = b"4;name=value\r\nWiki\r\n5\r\npedia\r\n0;done=yes\r\nX-Trailer: value\r\n\r\n";
        for split in 0..=wire.len() {
            for max_read in [1, 2, 7, READ_CHUNK] {
                let mut reader = Fragmented {
                    bytes: &wire[split..],
                    max_read,
                    eof_allowed: false,
                };
                assert_eq!(
                    capture_preview_body(
                        &mut reader,
                        &wire[..split],
                        PreviewBodyFraming::Chunked,
                        wire.len()
                    )
                    .unwrap(),
                    PreviewBodyCapture::Complete(b"Wikipedia".to_vec()),
                    "split {split}, max read {max_read}"
                );
            }
        }
        assert_eq!(
            capture_preview_body(&mut NoRead, b"0\r\n\r\n", PreviewBodyFraming::Chunked, 5)
                .unwrap(),
            PreviewBodyCapture::Complete(Vec::new())
        );
    }

    #[test]
    fn fallback_preserves_original_wire_bytes_and_leaves_the_rest_unread() {
        for framing in [
            PreviewBodyFraming::Chunked,
            PreviewBodyFraming::CloseDelimited,
        ] {
            let wire = b"20;ext=yes\r\nabcdefghijklmnopqrstuvwxyz012345\r\n0\r\n\r\n";
            let mut reader = Cursor::new(&wire[3..]);
            let captured = capture_preview_body(&mut reader, &wire[..3], framing, 17).unwrap();
            let PreviewBodyCapture::Passthrough(mut prefix) = captured else {
                panic!("large response must pass through");
            };
            assert_eq!(prefix, wire[..17]);
            reader.read_to_end(&mut prefix).unwrap();
            assert_eq!(prefix, wire);
        }
        assert_eq!(
            capture_preview_body(&mut NoRead, b"already read", PreviewBodyFraming::Chunked, 2)
                .unwrap(),
            PreviewBodyCapture::Passthrough(b"already read".to_vec())
        );
    }

    #[test]
    fn close_delimited_completion_and_exact_cap_conservatively_differ() {
        assert_eq!(
            capture_preview_body(
                &mut Cursor::new(b"world"),
                b"hello ",
                PreviewBodyFraming::CloseDelimited,
                12
            )
            .unwrap(),
            PreviewBodyCapture::Complete(b"hello world".to_vec())
        );
        assert_eq!(
            capture_preview_body(&mut NoRead, b"hello", PreviewBodyFraming::CloseDelimited, 5)
                .unwrap(),
            PreviewBodyCapture::Passthrough(b"hello".to_vec())
        );
    }

    #[test]
    fn incomplete_and_malformed_chunks_are_not_silently_injected() {
        for wire in [
            &b"1"[..],
            b"1\r\n",
            b"1\r\na",
            b"1\r\na\r\n",
            b"0\r\n",
            b"0\r\nX: trailer\r\n",
        ] {
            let error = capture_preview_body(
                &mut Cursor::new(wire),
                b"",
                PreviewBodyFraming::Chunked,
                1024,
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof, "{wire:?}");
        }
        for wire in [
            &b"z\r\n"[..],
            b"+1\r\n",
            b"\r\n",
            b"1\r\naXX0\r\n\r\n",
            b"1\r\na\rX0\r\n\r\n",
            b"FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\r\n",
        ] {
            let error = capture_preview_body(
                &mut Cursor::new(wire),
                b"",
                PreviewBodyFraming::Chunked,
                1024,
            )
            .unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData, "{wire:?}");
        }
        let error = capture_preview_body(
            &mut Cursor::new(b"short"),
            b"",
            PreviewBodyFraming::Length(10),
            10,
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn timeouts_preserve_bytes_while_other_read_errors_remain_errors() {
        struct EndingReader {
            bytes: Cursor<&'static [u8]>,
            kind: io::ErrorKind,
            interrupted: bool,
        }
        impl Read for EndingReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if !self.interrupted {
                    self.interrupted = true;
                    return Err(io::ErrorKind::Interrupted.into());
                }
                let read = self.bytes.read(buffer)?;
                if read == 0 {
                    Err(self.kind.into())
                } else {
                    Ok(read)
                }
            }
        }
        for framing in [
            PreviewBodyFraming::Length(100),
            PreviewBodyFraming::Chunked,
            PreviewBodyFraming::CloseDelimited,
        ] {
            for kind in [io::ErrorKind::TimedOut, io::ErrorKind::WouldBlock] {
                let mut reader = EndingReader {
                    bytes: Cursor::new(b"data"),
                    kind,
                    interrupted: false,
                };
                assert_eq!(
                    capture_preview_body(&mut reader, b"20\r\n", framing, 1024).unwrap(),
                    PreviewBodyCapture::Passthrough(b"20\r\ndata".to_vec())
                );
            }
        }
        let mut reader = EndingReader {
            bytes: Cursor::new(b"data"),
            kind: io::ErrorKind::ConnectionReset,
            interrupted: false,
        };
        assert_eq!(
            capture_preview_body(&mut reader, b"", PreviewBodyFraming::CloseDelimited, 1024)
                .unwrap_err()
                .kind(),
            io::ErrorKind::ConnectionReset
        );
    }

    #[test]
    fn tiny_chunks_decode_in_place_and_framing_metadata_is_bounded() {
        let wire = [b"1\r\nx\r\n".repeat(20_000), b"0\r\n\r\n".to_vec()].concat();
        let mut reader = Cursor::new(&wire);
        assert_eq!(
            capture_preview_body(&mut reader, b"", PreviewBodyFraming::Chunked, wire.len())
                .unwrap(),
            PreviewBodyCapture::Complete(vec![b'x'; 20_000])
        );
        let mut raw = b"2\r\nab\r\n1\r\nc\r\n0\r\n\r\n".to_vec();
        let pointer = raw.as_ptr();
        let end = ChunkedBodyState::default().advance(&raw).unwrap().unwrap();
        raw = decode_validated_chunks(raw, end);
        assert_eq!(raw, b"abc");
        assert_eq!(raw.as_ptr(), pointer);

        let huge_line = [
            b"1;extension=".to_vec(),
            vec![b'x'; MAX_CHUNK_LINE],
            b"\r\na\r\n0\r\n\r\n".to_vec(),
        ]
        .concat();
        let trailers = [
            b"0\r\n".to_vec(),
            b"X: value\r\n".repeat(MAX_TRAILERS / 10 + 1),
            b"\r\n".to_vec(),
        ]
        .concat();
        for wire in [huge_line, trailers] {
            let mut reader = Cursor::new(&wire);
            let captured = capture_preview_body(
                &mut reader,
                b"",
                PreviewBodyFraming::Chunked,
                MAX_TRAILERS * 2,
            )
            .unwrap();
            let PreviewBodyCapture::Passthrough(mut prefix) = captured else {
                panic!("large metadata must bypass optional injection");
            };
            reader.read_to_end(&mut prefix).unwrap();
            assert_eq!(prefix, wire);
        }
    }
}
