# Course Master Module

Admin-only CRUD API for managing the course catalog.

---

## Running the migration

The project uses `prisma db push` (no migration history files):

```bash
cd backend
npx prisma db push
npx prisma generate
```

Or if you want a tracked migration (first time setup):

```bash
cd backend
npx prisma migrate dev --name add_course_master
```

---

## Running the seed

```bash
cd backend
node src/prisma/seed.js
# or via npm script:
npm run db:seed
```

This is idempotent — running it twice will not duplicate courses. It inserts 7 courses on first run and skips them on subsequent runs.

---

## API endpoints

All endpoints are under `/api/v1/courses` and require a valid admin Bearer token.

### List courses

```bash
curl -X GET "http://localhost:3000/api/v1/courses?page=1&limit=10" \
  -H "Authorization: Bearer <TOKEN>"
```

With filters:

```bash
curl -X GET "http://localhost:3000/api/v1/courses?search=python&status=ACTIVE&page=1&limit=10" \
  -H "Authorization: Bearer <TOKEN>"
```

Response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "nameOfCourseAsGroup": "Data Science and AIML",
      "coupon": "EARLYBIRD20",
      "courseFee": "49999.00",
      "description": "Comprehensive program covering Python, machine learning, and deep learning.",
      "duration": "6 months",
      "status": "ACTIVE",
      "createdAt": "2026-05-09T10:00:00.000Z",
      "updatedAt": "2026-05-09T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 7, "totalPages": 1 }
}
```

### Get single course

```bash
curl -X GET "http://localhost:3000/api/v1/courses/1" \
  -H "Authorization: Bearer <TOKEN>"
```

### Create course

```bash
curl -X POST "http://localhost:3000/api/v1/courses" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "nameOfCourseAsGroup": "Cloud Computing with AWS",
    "courseFee": 35000,
    "coupon": "CLOUD10",
    "duration": "3 months",
    "description": "Master AWS services and cloud architecture fundamentals.",
    "status": "ACTIVE"
  }'
```

### Update course (partial)

```bash
curl -X PATCH "http://localhost:3000/api/v1/courses/1" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "courseFee": 52999, "status": "ACTIVE" }'
```

### Toggle status

```bash
curl -X PATCH "http://localhost:3000/api/v1/courses/1" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "status": "INACTIVE" }'
```

### Delete course

```bash
curl -X DELETE "http://localhost:3000/api/v1/courses/1" \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Query parameters (GET /courses)

| Param    | Type    | Default | Description                                          |
|----------|---------|---------|------------------------------------------------------|
| `page`   | integer | 1       | Page number                                          |
| `limit`  | integer | 10      | Records per page (max 100)                           |
| `search` | string  | —       | Case-insensitive partial match on course name        |
| `status` | string  | —       | Filter by `ACTIVE` or `INACTIVE`; omit for both      |

---

## Admin frontend route

Access the Courses admin page at:

```
http://localhost:5173/admin/courses
```

(Requires login — unauthenticated users are redirected to `/login`)

---

## Permissions

| Permission code    | Who has it               | What it grants            |
|--------------------|--------------------------|---------------------------|
| `courses:view`     | superadmin, admin        | Read access to all 5 GET endpoints |
| `courses:manage`   | superadmin, admin        | POST, PATCH, DELETE        |

Both permissions are seeded automatically by `npm run db:seed`.
