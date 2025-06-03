// convert-excel-to-json.js
const xlsx = require('xlsx')
const fs = require('fs')

const workbook = xlsx.readFile('./students.xlsx')
const sheet = workbook.Sheets[workbook.SheetNames[0]]
const data = xlsx.utils.sheet_to_json(sheet)

fs.writeFileSync('students.json', JSON.stringify(data, null, 2))
console.log('✅ students.json generated')
