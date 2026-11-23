use std::path::PathBuf;

/// A Command for a *host* program (spectacle, dbus-send, …) from inside an
/// AppImage: the runtime exports LD_LIBRARY_PATH, QT_PLUGIN_PATH, GTK_PATH,
/// PYTHONHOME and friends pointing into the mount, which breaks any other
/// program that inherits them. Strip those, and the mount's entries from
/// PATH-like lists, so the tool runs exactly as it would from a shell.
pub(crate) fn host_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(program);
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let appdir = PathBuf::from(appdir);
        for var in [
            "LD_LIBRARY_PATH", "LD_PRELOAD", "QT_PLUGIN_PATH", "QML2_IMPORT_PATH", "GTK_PATH", "GIO_MODULE_DIR",
            "GSETTINGS_SCHEMA_DIR", "PYTHONHOME", "PYTHONPATH", "PERLLIB", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_SYSTEM_PATH_1_0",
        ] {
            cmd.env_remove(var);
        }
        for var in ["PATH", "XDG_DATA_DIRS"] {
            if let Some(value) = std::env::var_os(var) {
                let kept: Vec<PathBuf> = std::env::split_paths(&value).filter(|p| !p.starts_with(&appdir)).collect();
                if let Ok(joined) = std::env::join_paths(kept) {
                    cmd.env(var, joined);
                }
            }
        }
    }
    cmd
}
