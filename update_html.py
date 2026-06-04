import sys
with open('index_nox.html', 'r', encoding='utf-8') as f:
    content = f.read()

html_part = content.split('<script>')[0]
csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}'; img-src data: {{cspSource}} vscode-resource: https:;\">"
html_part = html_part.replace('<meta name="viewport" content="width=device-width, initial-scale=1.0" />', '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' + csp)

final_html = html_part + """<script nonce="{{nonce}}" src="{{scriptUri}}"></script>
</body>
</html>"""

with open('resources/webview/index.html', 'w', encoding='utf-8') as f:
    f.write(final_html)
print('Done!')
