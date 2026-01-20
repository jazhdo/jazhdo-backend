const http = require('http');
const httpProxy = require('http-proxy');
const proxy = httpProxy.createProxyServer({});
const port = 3000;

proxy.on('error', (err, req, res) => {
	console.error('Proxy error:', err);
	res.writeHead(500, {
		'Content-Type': 'text/plain'
	});
	res.end('Something went wrong with the proxy.');
});

const server = http.createServer((req, res) => {
	const targetUrl = req.url.slice(1);

	if (!targetUrl.startsWith('http')) {
		res.writeHead(400, { 'Content-Type': 'text/plain' });
		res.end('Please specify a valid target URL in the path (e.g., /https://example.com)');
		return;
	}
	console.log(`Proxying request to: ${targetUrl}`);
	proxy.web(req, res, { target: targetUrl, changeOrigin: true});
});

server.listen(port, () => {
	console.log(`Proxy server is running on http://localhost:${port}`);
	console.log(`Access websites via this proxy (e.g., http://localhost:${port})`);
});
