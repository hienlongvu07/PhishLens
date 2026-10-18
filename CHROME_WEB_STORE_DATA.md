# Chrome Web Store data-use declaration

Use this as the declaration reference when publishing an updated PhishLens extension.

- The extension does not add permissions and does not read page content, form values, cookies, browser history, or passwords.
- URL analysis and comparison against the locally cached Phishing.Database feed remain on the device. The extension downloads the public feed from the configured PhishLens website; it does not include the current hostname in that download request.
- If the user separately requests AI explanation, the existing flow sends only the hostname and extracted signal codes to the PhishLens server; it does not send the full URL or page content.
- The community links in the popup open the selected PhishLens page in a new tab only after the user clicks. The extension does not automatically submit Beta feedback or campaign events.
- Challenge and Beta Testing are website features. When a user visits those pages, the website sends a Turnstile token to Cloudflare for server-side verification and stores anonymous activity or feedback in Supabase. The extension itself does not collect that feedback.
- Do not declare that the extension collects community feedback, campaign visits, or Challenge answers. Disclose the existing AI hostname/signal transfer separately in the extension’s privacy/data-use declarations.

Review this statement against the exact submitted extension build and current Chrome Web Store questionnaire before publishing.
