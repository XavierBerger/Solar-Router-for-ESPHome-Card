use fronius_simulator::{api, config::Config};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("{message}");
        std::process::exit(2);
    }
}

async fn run() -> Result<(), String> {
    let config = Config::from_env_and_args()?;
    let bind = config.bind;
    let app = api::router(config);
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|error| format!("cannot bind {bind}: {error}"))?;

    println!("Fronius simulator listening on http://{bind}");
    report_viewer_directory();

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("HTTP server failed: {error}"))
}

/// The viewer is served from a path relative to the working directory, so a
/// missing mount or a run from the wrong directory only shows up as a bare 404.
fn report_viewer_directory() {
    match std::fs::canonicalize(api::VIEWER_DIR) {
        Ok(path) if path.is_dir() => println!("Viewer served from {}", path.display()),
        _ => eprintln!(
            "WARNING: viewer directory {:?} not found under {:?}; \
             the static viewer will return 404 (Fronius API unaffected)",
            api::VIEWER_DIR,
            std::env::current_dir().unwrap_or_default().display()
        ),
    }
}
