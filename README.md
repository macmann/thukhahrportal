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

The application uses a JSON file database. By default it is stored at
`mnt/data/db.json`. You can change the location by setting the `DB_PATH`
environment variable. The database file is listed in `.gitignore` to prevent
it from being overwritten when pulling updates from GitHub.

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
