// Release builds on Windows are GUI apps: without this, Windows opens a console window next
// to the app (showing its stderr) and closing that window quits Kaiflow. Debug builds keep the
// console for the logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    kaiflow_lib::run()
}
