use fronius_simulator::{api, config::Config};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let config = match Config::from_env_and_args() {
        Ok(config) => config,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    };

    let bind = config.bind;
    let app = api::router(config);
    let listener = TcpListener::bind(bind)
        .await
        .expect("failed to bind Fronius simulator HTTP listener");

    println!("Fronius simulator listening on http://{bind}");
    axum::serve(listener, app)
        .await
        .expect("Fronius simulator HTTP server failed");
}
