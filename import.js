// import.js
const fs    = require('fs');
const path  = require('path');
// Use the supported sync parser entrypoint:
const { parse } = require('csv-parse/sync');

// 1. Read your CSV (make sure you’ve placed your file here)
const csvPath = path.join(__dirname, 'BrillarEmployees.csv');
const csvText = fs.readFileSync(csvPath, 'utf-8');

// 2. Parse into row-objects
const rows = parse(csvText, {
  columns: true,
  skip_empty_lines: true
});

// 3. Map rows → your JSON structure, pulling Name into name:
const employees = rows.map((row, i) => ({
  id: Date.now() + i,
  name: row['Name'],   // ← ensure this matches your CSV header exactly
  status: row.Status?.toLowerCase() === 'inactive' ? 'inactive' : 'active',
  leaveBalances: {
    annual:  Number(row['Annual Leave']  ?? 10),
    casual:  Number(row['Casual Leave']   ?? 5),
    medical: Number(row['Medical Leave'] ?? 14)
  },
  // keep the rest of your columns too, if you like:
  ...row
}));

// 4. Build the final DB object
const db = {
  employees,
  applications: []
};

// 5. Write it out
fs.writeFileSync(
  path.join(__dirname, 'db.json'),
  JSON.stringify(db, null, 2),
  'utf-8'
);

console.log(`Imported ${employees.length} employees into db.json`);
