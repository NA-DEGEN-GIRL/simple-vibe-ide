#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::var_os("SVIDE_ASKPASS_HELPER").is_some() {
        std::process::exit(simple_vibe_ide_lib::run_ssh_askpass_helper());
    }
    simple_vibe_ide_lib::run();
}
