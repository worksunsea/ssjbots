"""
Biometric XLSX → HR App CSV converter
Run: python3 convert_attendance.py
Reads: timeing .xlsx (or any file matching the same format)
Output: attendance.csv  (upload this in HR app → Attendance → Upload Biometric CSV)
"""

import openpyxl, csv
from datetime import date
import sys, os

INPUT = os.path.join(os.path.dirname(__file__), "timeing .xlsx")
OUTPUT = os.path.join(os.path.dirname(__file__), "attendance.csv")

wb = openpyxl.load_workbook(INPUT)
ws = wb["Sheet1"]
rows = list(ws.iter_rows(values_only=True))

# Row 2: "01/04/2026 ~ 30/04/2026"
duration_cell = rows[1][2]
start_str = str(duration_cell).split("~")[0].strip()
day_s, month_s, year_s = start_str.split("/")
year, month = int(year_s), int(month_s)

day_nums = rows[2][2:]   # (1, 2, 3 ... 30)

out_rows = [["Name", "Date", "In", "Out"]]

for row in rows[4:]:
    emp_name = row[1]
    if not emp_name:
        continue
    emp_name = str(emp_name).strip()

    for i, day_num in enumerate(day_nums):
        if day_num is None:
            continue
        cell = row[2 + i]
        if not cell:
            continue  # absent / day off

        punches = [p.strip() for p in str(cell).split("\n") if p.strip()]
        if not punches:
            continue

        in_time  = punches[0]
        out_time = punches[-1] if len(punches) > 1 else ""

        dt = date(year, month, int(day_num))
        out_rows.append([emp_name, dt.strftime("%Y-%m-%d"), in_time, out_time])

with open(OUTPUT, "w", newline="") as f:
    csv.writer(f).writerows(out_rows)

print(f"Done. {len(out_rows)-1} records written to {OUTPUT}")
print("Upload this CSV in HR App → Attendance tab → Upload Biometric CSV")
