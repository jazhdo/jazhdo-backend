import http from 'http';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({});

proxy.on('error', (err, req, res) => {
	console.error('Proxy error:\n', err);
	res.writeHead(500, {
		'Content-Type': 'text/plain'
	});
	res.end('Something went wrong with the proxy.');
});

const server = http.createServer((req, res) => {
	const targetUrl = req.url.slice(7);
	if (!req.url.slice(1)) {
		res.statusCode = 200;
		res.end();
	}
	if (!targetUrl.startsWith('http')) {
		res.writeHead(400, { 'Content-Type': 'text/plain' });
		console.log('Error proxying request to:', targetUrl)
		res.end('Please specify a valid target URL in the path (e.g., /https://example.com)');
		return;
	}
	console.log(`Proxying request to: ${targetUrl}`);
	const parsed = new URL(targetUrl);
	req.url = parsed.pathname + parsed.search;
	proxy.web(req, res, { target: `${parsed.protocol}//${parsed.host}`, changeOrigin: true});
});

server.listen(3002, () => {
    console.log(`Starting server...`);
    console.log(`Access at http://[RPI_IP_ADDRESS]:3000/proxy/\nMore information can be found at https://github.com/jazhdo/jazhdo-backend/wiki`);
});
