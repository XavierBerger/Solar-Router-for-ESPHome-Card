use std::{env, net::SocketAddr, time::Duration};

const DEFAULT_BIND: &str = "0.0.0.0:8080";
const DEFAULT_DAY_DURATION_SECONDS: u64 = 86_400;
const DEFAULT_PEAK_POWER_W: f64 = 5_500.0;
const DEFAULT_BASE_LOAD_W: f64 = 420.0;
const DEFAULT_SEED: u64 = 17;
const DEFAULT_SITE_NAME: &str = "Development Fronius Simulator";
const DEFAULT_START_TIME: &str = "06:00:00";

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub day_duration: Duration,
    pub start_time_seconds: f64,
    pub peak_power_w: f64,
    pub base_load_w: f64,
    pub seed: u64,
    pub site_name: String,
}

impl Config {
    pub fn from_env_and_args() -> Result<Self, String> {
        let mut config = Self::from_env()?;
        let mut args = env::args().skip(1);

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--bind" => {
                    let value = next_arg(&mut args, "--bind")?;
                    config.bind = parse_socket_addr(&value, "--bind")?;
                }
                "--day-duration-seconds" => {
                    let value = next_arg(&mut args, "--day-duration-seconds")?;
                    config.day_duration = parse_day_duration(&value, "--day-duration-seconds")?;
                }
                "--start-time" => {
                    let value = next_arg(&mut args, "--start-time")?;
                    config.start_time_seconds = parse_time_of_day(&value)?;
                }
                "--peak-power-w" => {
                    let value = next_arg(&mut args, "--peak-power-w")?;
                    config.peak_power_w = parse_positive_f64(&value, "--peak-power-w")?;
                }
                "--base-load-w" => {
                    let value = next_arg(&mut args, "--base-load-w")?;
                    config.base_load_w = parse_positive_f64(&value, "--base-load-w")?;
                }
                "--seed" => {
                    let value = next_arg(&mut args, "--seed")?;
                    config.seed = value.parse().map_err(|_| {
                        format!("--seed must be an unsigned integer, got {value:?}")
                    })?;
                }
                "--site-name" => {
                    config.site_name = next_arg(&mut args, "--site-name")?;
                }
                "--help" | "-h" => {
                    return Err(help_text());
                }
                unknown => return Err(format!("unknown argument {unknown:?}\n\n{}", help_text())),
            }
        }

        Ok(config)
    }

    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            bind: parse_socket_addr(&env_or("SIM_BIND", DEFAULT_BIND), "SIM_BIND")?,
            day_duration: parse_day_duration(
                &env_or(
                    "SIM_DAY_DURATION_SECONDS",
                    &DEFAULT_DAY_DURATION_SECONDS.to_string(),
                ),
                "SIM_DAY_DURATION_SECONDS",
            )?,
            start_time_seconds: parse_time_of_day(&env_or("SIM_START_TIME", DEFAULT_START_TIME))?,
            peak_power_w: parse_positive_f64(
                &env_or("SIM_PEAK_POWER_W", &DEFAULT_PEAK_POWER_W.to_string()),
                "SIM_PEAK_POWER_W",
            )?,
            base_load_w: parse_positive_f64(
                &env_or("SIM_BASE_LOAD_W", &DEFAULT_BASE_LOAD_W.to_string()),
                "SIM_BASE_LOAD_W",
            )?,
            seed: env_or("SIM_SEED", &DEFAULT_SEED.to_string())
                .parse()
                .map_err(|_| "SIM_SEED must be an unsigned integer".to_string())?,
            site_name: env_or("SIM_SITE_NAME", DEFAULT_SITE_NAME),
        })
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind: DEFAULT_BIND.parse().expect("valid default bind address"),
            day_duration: Duration::from_secs(DEFAULT_DAY_DURATION_SECONDS),
            start_time_seconds: parse_time_of_day(DEFAULT_START_TIME)
                .expect("valid default start time"),
            peak_power_w: DEFAULT_PEAK_POWER_W,
            base_load_w: DEFAULT_BASE_LOAD_W,
            seed: DEFAULT_SEED,
            site_name: DEFAULT_SITE_NAME.to_string(),
        }
    }
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

fn next_arg(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<String, String> {
    args.next()
        .ok_or_else(|| format!("{flag} requires a value"))
}

fn parse_socket_addr(value: &str, name: &str) -> Result<SocketAddr, String> {
    value
        .parse()
        .map_err(|_| format!("{name} must be a socket address like 0.0.0.0:8080"))
}

fn parse_day_duration(value: &str, name: &str) -> Result<Duration, String> {
    let seconds: u64 = value
        .parse()
        .map_err(|_| format!("{name} must be a positive integer number of seconds"))?;
    if seconds == 0 {
        return Err(format!("{name} must be greater than zero"));
    }
    Ok(Duration::from_secs(seconds))
}

fn parse_positive_f64(value: &str, name: &str) -> Result<f64, String> {
    let parsed: f64 = value
        .parse()
        .map_err(|_| format!("{name} must be a positive number"))?;
    if parsed <= 0.0 || !parsed.is_finite() {
        return Err(format!("{name} must be a positive finite number"));
    }
    Ok(parsed)
}

pub fn parse_time_of_day(value: &str) -> Result<f64, String> {
    let parts: Vec<&str> = value.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return Err("SIM_START_TIME must use HH:MM or HH:MM:SS".to_string());
    }

    let hour: u32 = parts[0]
        .parse()
        .map_err(|_| "SIM_START_TIME has an invalid hour".to_string())?;
    let minute: u32 = parts[1]
        .parse()
        .map_err(|_| "SIM_START_TIME has an invalid minute".to_string())?;
    let second: u32 = if parts.len() == 3 {
        parts[2]
            .parse()
            .map_err(|_| "SIM_START_TIME has an invalid second".to_string())?
    } else {
        0
    };

    if hour > 23 || minute > 59 || second > 59 {
        return Err("SIM_START_TIME must be within 00:00:00 and 23:59:59".to_string());
    }

    Ok((hour * 3_600 + minute * 60 + second) as f64)
}

fn help_text() -> String {
    [
        "Fronius Solar API simulator",
        "",
        "Options:",
        "  --bind <ADDR>                   HTTP bind address, default 0.0.0.0:8080",
        "  --day-duration-seconds <SEC>   Real seconds per simulated day",
        "  --start-time <HH:MM[:SS]>      Simulated time at process start",
        "  --peak-power-w <W>             PV peak power in watts",
        "  --base-load-w <W>              Residential baseline load in watts",
        "  --seed <N>                     Deterministic cloud/noise seed",
        "  --site-name <NAME>             Human-readable simulated site name",
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::parse_time_of_day;

    #[test]
    fn parses_hour_minute_second_start_time() {
        assert_eq!(parse_time_of_day("07:30:05").unwrap(), 27_005.0);
    }

    #[test]
    fn rejects_out_of_range_start_time() {
        assert!(parse_time_of_day("24:00").is_err());
        assert!(parse_time_of_day("12:60").is_err());
    }
}
