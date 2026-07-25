Backend container על Railway + PostgreSQL נפרד ב־Neon Free.


init db:
  npm run db:generate-problems-bootstrap  // add initial content to table "problems"
  npm run db:migrate
  to run mobile tests: need emulator up and:
        API_BASE=http://10.0.2.2:8080 HOST_API_BASE=http://127.0.0.1:8080  pnpm mobile:delta
        

כן. עבור ה־MVP זה סדר הגיוני. הייתי משנה מעט את הסדר:

✅ Deploy backend locally
Docker Compose
PostgreSQL
Better Auth
API עולה ועובד
✅ First migration
יצירת כל הטבלאות
לוודא ש־drizzle migrate עובד על DB ריק
✅ Populate problems table
Seeder/import script
Idempotent (אפשר להריץ שוב ללא כפילויות)
✅ Deploy backend remotely
PostgreSQL
Backend
HTTPS
Domain
Backups
Environment variables
✅ Test Android app against remote backend
Login
Sync
Solve problems
Offline/online
Update flow
פלטפורמה מומ
