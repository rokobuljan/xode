# Xode

Simple fiddling code editor for the web

## Deployment

Serve the app shell with `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`. `public/_headers` configures these headers on compatible static hosts; configure the equivalent response headers directly when the host does not support that file.
