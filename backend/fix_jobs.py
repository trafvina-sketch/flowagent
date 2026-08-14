import sqlite3
conn = sqlite3.connect('jobs.db')
c = conn.cursor()
c.execute("UPDATE flow_jobs SET status='FAILED' WHERE status='PROCESSING'")
conn.commit()
print(f"Updated {c.rowcount} stuck jobs to FAILED")
c.execute("SELECT id, status, url FROM flow_jobs")
for r in c.fetchall():
    print(f"  {r[0][:8]}... status={r[1]} url={r[2]}")
conn.close()
