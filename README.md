# Brillar HR Portal

This is a simple leave management system built with Node.js and Express.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. (Optional) Import employees from the provided CSV:
   ```bash
   node import.js
   ```

## Email Notifications

The server can send email notifications when leave applications are submitted or their status changes. Configure SMTP credentials with the following environment variables:

- `SMTP_HOST` - SMTP server host
- `SMTP_PORT` - SMTP server port (default `587`)
- `SMTP_USER` - SMTP login username
- `SMTP_PASS` - SMTP login password
- `SMTP_SECURE` - set to `true` to use TLS
- `SMTP_FROM` - (optional) address used in the `From` header

If these variables are not set, emails will be skipped.
