//! The one HTTP client every request goes through.
//!
//! A reqwest client owns a connection pool and a TLS setup, so building one per
//! call threw both away each time. Sharing one keeps connections to the server
//! warm, and gives every request a deadline: a client without a timeout waits
//! forever on a server that accepted the connection and then went quiet.

use std::sync::LazyLock;
use std::time::Duration;

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // The default for small JSON calls. Uploads and downloads that take
        // longer set their own on the request, which overrides this one.
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("StarBuddy/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("the HTTP client could not be built")
});

pub fn client() -> &'static reqwest::Client {
    &CLIENT
}
