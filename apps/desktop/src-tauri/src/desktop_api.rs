use reqwest::{header, Client, Method, Url};
use serde::Serialize;
use std::time::Duration;
use tauri::{webview::Cookie, State, WebviewWindow};
use tokio::sync::Mutex;

const SESSION_NAME: &str = "cortex_session";
const STORAGE_DOMAIN: &str = "cortex-desktop.invalid";
const DEFAULT_ORIGIN: &str = "http://115.190.3.4:30090";

pub(crate) struct DesktopApi {
    origin: Url,
    storage_name: String,
    client: Client,
    auth_mutations: Mutex<()>,
}

impl DesktopApi {
    pub(crate) fn new() -> Result<Self, &'static str> {
        let configured = option_env!("CORTEX_DESKTOP_API_ORIGIN").unwrap_or(DEFAULT_ORIGIN);
        let origin = Url::parse(configured).map_err(|_| "invalid desktop API origin")?;
        if !matches!(origin.scheme(), "http" | "https")
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
        {
            return Err("invalid desktop API origin");
        }
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .map_err(|_| "cannot initialize desktop network client")?;
        // Scope native cookie storage by the entire origin, including port.
        let key: String = origin
            .origin()
            .ascii_serialization()
            .bytes()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let storage_name = format!("cortex_desktop_{key}");
        Ok(Self {
            origin,
            storage_name,
            client,
            auth_mutations: Mutex::new(()),
        })
    }

    pub(crate) fn initialization_script(&self) -> String {
        let origin = serde_json::to_string(&self.origin.origin().ascii_serialization())
            .expect("serialize desktop API origin");
        format!(
            "if (location.protocol === 'tauri:' && location.host === 'localhost') {{ \
             window.__CORTEX_DESKTOP_ORIGIN__ = {origin}; }}"
        )
    }
}

fn api_url(origin: &Url, path: &str) -> Result<Url, &'static str> {
    if !path.starts_with("/api/") || path.contains('\\') {
        return Err("无效的账号服务路径");
    }
    let url = origin.join(path).map_err(|_| "无效的账号服务路径")?;
    let normalized = url.path().to_ascii_lowercase();
    if url.origin() != origin.origin()
        || !normalized.starts_with("/api/")
        || url.fragment().is_some()
        || ["%2f", "%5c", "%00"]
            .iter()
            .any(|escape| normalized.contains(escape))
    {
        return Err("无效的账号服务路径");
    }
    Ok(url)
}

fn is_token(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn native_session(cookie: &Cookie<'_>, origin: &Url, storage_name: &str) -> bool {
    cookie.name() == storage_name
        && cookie.domain() == Some(STORAGE_DOMAIN)
        && cookie.path() == Some("/")
        && cookie.http_only() == Some(true)
        && (origin.scheme() == "https" || cookie.secure() != Some(true))
        && !expired(cookie)
        && is_token(cookie.value())
}

fn expired(cookie: &Cookie<'_>) -> bool {
    if let Some(age) = cookie.max_age() {
        return age.whole_seconds() <= 0;
    }
    cookie
        .expires_datetime()
        .is_some_and(|expiry| expiry <= cookie::time::OffsetDateTime::now_utc())
}

fn save_session(
    window: &WebviewWindow,
    origin: &Url,
    storage_name: &str,
    stored: Option<Cookie<'static>>,
    headers: &header::HeaderMap,
) -> Result<(), &'static str> {
    for header in headers.get_all(header::SET_COOKIE) {
        let Ok(header) = header.to_str() else {
            continue;
        };
        let Ok(cookie) = Cookie::parse(header) else {
            continue;
        };
        if cookie.name() != SESSION_NAME
            || cookie
                .domain()
                .is_some_and(|domain| Some(domain) != origin.host_str())
            || cookie.path().is_some_and(|path| path != "/")
        {
            continue;
        }
        if expired(&cookie) {
            if let Some(stored) = stored {
                window
                    .delete_cookie(stored)
                    .map_err(|_| "无法清除桌面登录会话")?;
            }
            return Ok(());
        }
        if !is_token(cookie.value())
            || (origin.scheme() != "https" && cookie.secure() == Some(true))
        {
            return Err("无法保存桌面登录会话");
        }
        let mut cookie = cookie.into_owned();
        cookie.set_name(storage_name.to_owned());
        // The reserved storage domain keeps the alias off normal WebKit requests.
        cookie.set_domain(STORAGE_DOMAIN);
        cookie.set_path("/");
        cookie.set_http_only(true);
        // WKWebView persists cookies with an absolute expiry. Normalize
        // Max-Age so the existing lifetime survives an app restart.
        if let Some(age) = cookie.max_age() {
            cookie.set_expires(cookie::time::OffsetDateTime::now_utc().saturating_add(age));
            cookie.set_max_age(None);
        }
        return window
            .set_cookie(cookie)
            .map_err(|_| "无法保存桌面登录会话");
    }
    Ok(())
}

#[derive(Serialize)]
pub(crate) struct DesktopResponse {
    status: u16,
    body: String,
}

#[tauri::command]
pub(crate) async fn desktop_api_request(
    window: WebviewWindow,
    api: State<'_, DesktopApi>,
    path: String,
    method: String,
    user_id: Option<String>,
    body: Option<String>,
    timeout_ms: u64,
) -> Result<DesktopResponse, &'static str> {
    let page = window.url().map_err(|_| "无法读取桌面工作区")?;
    if window.label() != "main" || page.scheme() != "tauri" || page.host_str() != Some("localhost")
    {
        return Err("请求来源不受信任");
    }
    let url = api_url(&api.origin, &path)?;
    let method = match method.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        "PUT" => Method::PUT,
        "PATCH" => Method::PATCH,
        "DELETE" => Method::DELETE,
        _ => return Err("无效的账号服务请求方法"),
    };
    let auth_mutation = method == Method::POST
        && matches!(
            url.path(),
            "/api/auth/login" | "/api/auth/register" | "/api/auth/logout"
        );
    let _auth_guard = if auth_mutation {
        Some(api.auth_mutations.lock().await)
    } else {
        None
    };
    // Read the private native cookie, which is intentionally off the API URL.
    let stored = window
        .cookies()
        .map_err(|_| "无法读取桌面登录会话")?
        .into_iter()
        .find(|cookie| native_session(cookie, &api.origin, &api.storage_name));
    let mut request = api
        .client
        .request(method, url)
        .timeout(Duration::from_millis(timeout_ms.clamp(100, 30_000)))
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(user_id) = user_id {
        let value = header::HeaderValue::from_str(&user_id).map_err(|_| "无效的账号标识")?;
        request = request.header("X-Cortex-User", value);
    }
    if let Some(cookie) = &stored {
        let mut value =
            header::HeaderValue::from_str(&format!("{SESSION_NAME}={}", cookie.value()))
                .map_err(|_| "无效的桌面登录会话")?;
        value.set_sensitive(true);
        request = request.header(header::COOKIE, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await.map_err(|_| "无法连接账号服务器")?;
    let status = response.status().as_u16();
    if auth_mutation {
        save_session(
            &window,
            &api.origin,
            &api.storage_name,
            stored,
            response.headers(),
        )?;
    }
    let body = response.text().await.map_err(|_| "无法读取账号服务响应")?;
    Ok(DesktopResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_api_rejects_paths_outside_the_pinned_api() {
        let origin = Url::parse(DEFAULT_ORIGIN).unwrap();
        assert!(api_url(&origin, "/api/auth/ticket?userId=x&purpose=sync").is_ok());
        for path in [
            "//example.com/api/auth/me",
            "/api/../healthz",
            "/api/%2e%2e/healthz",
            "/api/%2f../healthz",
            "/api/auth/me#fragment",
            "/api/\\..\\healthz",
        ] {
            assert!(api_url(&origin, path).is_err(), "allowed {path}");
        }
    }

    #[test]
    fn desktop_session_requires_private_storage_and_http_only() {
        let origin = Url::parse(DEFAULT_ORIGIN).unwrap();
        let name = "cortex_desktop_test";
        let mut cookie = Cookie::build((name, "a".repeat(64)))
            .domain(STORAGE_DOMAIN)
            .path("/")
            .http_only(true)
            .build();
        assert!(native_session(&cookie, &origin, name));
        assert!(!native_session(
            &cookie,
            &origin,
            "cortex_desktop_other_origin"
        ));
        cookie.set_domain("115.190.3.4");
        assert!(!native_session(&cookie, &origin, name));
        cookie.set_domain(STORAGE_DOMAIN);
        cookie.set_http_only(false);
        assert!(!native_session(&cookie, &origin, name));
    }
}
