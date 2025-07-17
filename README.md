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

### CSV Columns

When uploading employees via CSV or the `import.js` script, include an `Email`
column and a `Role` column. The role should be either `employee` or `manager`.
User accounts will be created automatically with the email address and the
default password `brillar`.

## Database Storage

The application now stores data in MongoDB. Set the connection string using the
`MONGODB_URI` environment variable and optionally `MONGODB_DB` for the database
name. If these are not provided the server connects to
`mongodb://localhost:27017/brillarhrportal`.

## Email Notifications

The server can send email notifications when leave applications are submitted or their status changes. Configure SMTP credentials with the following environment variables:

- `SMTP_HOST` - SMTP server host
- `SMTP_PORT` - SMTP server port (default `587`)
- `SMTP_USER` - SMTP login username
- `SMTP_PASS` - SMTP login password
- `SMTP_SECURE` - set to `true` to use TLS
- `SMTP_FROM` - (optional) address used in the `From` header

If these variables are not set, emails will be skipped.

## Admin Login

When the database is empty, you can still log in using a special admin
account to upload employee data. Configure the credentials with the
`ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables. They default to
`admin@brillar.io` and `admin`.

## Microsoft SSO

To allow users to sign in using their Office&nbsp;365 account, configure Azure AD
OAuth credentials with the following environment variables:

- `MS_CLIENT_ID` – Azure application client ID
- `MS_CLIENT_SECRET` – Azure application client secret
- `MS_TENANT` – tenant ID (default `common`)
- `MS_REDIRECT_URI` – callback URL (default
  `http://localhost:3000/auth/microsoft/callback`)

When enabled, the login page shows a **Sign in with Microsoft&nbsp;365** button.
