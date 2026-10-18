# MAJNU-MD WhatsApp Bot

Baileys multi-device bot with a browser QR page and a small set of real working commands.

## Commands included

- `.menu`, `.help`, `.ping`, `.alive`, `.owner`
- `.groupinfo`
- `.sticker` — reply to an image or short video
- `.welcome on/off` — welcome and goodbye messages
- `.antilink on/off` — attempts to delete group links from non-admin members
- `.tagall [message]`
- `.promote`, `.demote`, `.kick` — reply to the target member or mention them
- `.lock`, `.unlock` — group announcement mode

Group moderation commands require the bot to be a group admin and require the command sender to be a group admin (or configured owner). Test responsibly in a group you manage.

## Deploy from mobile (no Termux)

1. Upload this ZIP's extracted files to a GitHub repository. Do not upload `.env` or the `auth_info` folder.
2. Create a new **Web Service** on a Node.js hosting provider from that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set environment variables:
   - `PREFIX` = `.`
   - `OWNER_NUMBER` = your own WhatsApp number in international format, digits only, e.g. `919876543210`
6. Deploy, then open your service URL and add `/qr` (example: `https://your-service.example/qr`).
7. On your own phone, open WhatsApp → Linked devices → Link a device, then scan the QR.
8. Send `.menu` to the bot's WhatsApp chat to test it.

## Important hosting note

Baileys is an unofficial WhatsApp Web client library, not the official WhatsApp Business Platform. Use it at your own risk and avoid bulk messaging/spam. Free hosting may sleep, restart, or erase local files. If the host does not provide persistent storage, WhatsApp's saved login session (`auth_info/`) may disappear and you may need to scan a new QR. Keep the `auth_info/` directory private and never commit it to GitHub. Some hosts prohibit WhatsApp automation; check their current rules before deploying.

## QR troubleshooting

- QR page is `/qr`; health check is `/health`.
- If the page says it is waiting, check hosting logs for `[MAJNU-MD] QR ready`.
- If already connected, `/qr` displays Connected.
- If logged out, remove the private `auth_info` folder from the host's persistent storage (if available), restart, and scan a fresh QR.
- Never share your QR, session files, or owner secrets.

## Limits

This ZIP does not include third-party downloader API keys. YouTube/Instagram/Facebook downloading, AI APIs, and other external services require their own valid API/provider and integration. The included commands are implemented directly; the menu intentionally does not claim unimplemented commands.
