// Cloudflare Worker: proxy dgsolutionspa.com/service-desk/* → Railway app
// The app is built with base path "/" so the Worker forwards ALL requests that
// come in under /service-desk by stripping that prefix.
//
// Deploy at: Workers & Pages → Create Worker → Paste this code
// Then add TWO routes pointing to this worker:
//   dgsolutionspa.com/service-desk*
//   dgsolutionspa.com/service-desk/*
//
// In Cloudflare DNS, add:  CNAME @ postgresql-production-5bd1.up.railway.app
// (proxied / orange cloud ON)

const RAILWAY_URL = "https://postgresql-production-5bd1.up.railway.app"
const BASE_PATH = "/service-desk"

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Strip /service-desk prefix, forward the rest to Railway
    let path = url.pathname
    if (path.startsWith(BASE_PATH + "/")) {
      path = path.slice(BASE_PATH.length) // e.g. /service-desk/login → /login
    } else if (path === BASE_PATH) {
      path = "/"
    }

    const targetUrl = RAILWAY_URL + path + url.search

    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  },
}
