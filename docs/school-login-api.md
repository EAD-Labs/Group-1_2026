# A small login API for school.edupyramids.org

For the EduPyramids tech team. EduPyramids (the gamified Python app, ET617
Group 1) signs students, teachers and coordinators in with their existing
school accounts. It needs one endpoint on the school site that checks an email
and password and says which roles the person has. Nothing else: the app never
reads the school database and stores only name, email and role.

## The endpoint

```
POST /api/edupyramids/verify-user/
Authorization: Bearer <shared key>
Content-Type: application/json

{ "email": "student@example.com", "password": "..." }
```

| Case | Status | Body |
| --- | --- | --- |
| Right password | 200 | `{"status": "success", "user": {"spoken_user_id": 123, "username": "...", "email": "...", "first_name": "...", "last_name": "...", "roles": ["student"]}}` |
| Wrong email or password | 401 | `{"status": "error", "message": "Invalid credentials"}` |
| Account disabled | 403 | `{"status": "error", "message": "Account is disabled"}` |
| Missing or wrong key | 401 | `{"status": "error", "message": "Not allowed"}` |

`roles` lists only roles that are **approved** and valid today, using the
names already in `accounts_userrolemapping` (`student`, `invigilator`,
`teacher`, `main_school_coord`, `national_coord`, `org_partner`). An empty list
means the person cannot use the app yet.

## The code

In the `accounts` app. The model and field names below are taken from the
database tables (`accounts_user`, `accounts_userrolemapping`); adjust the import
if the model class is named differently.

```python
# accounts/edupyramids_api.py
import hmac
import json

from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.db.models import Q

from accounts.models import User, UserRoleMapping


def _error(message, status):
    return JsonResponse({"status": "error", "message": message}, status=status)


@csrf_exempt
@require_POST
def edupyramids_verify_user(request):
    # Only the EduPyramids server knows this key.
    expected = f"Bearer {settings.EDUPYRAMIDS_API_KEY}"
    if not hmac.compare_digest(request.headers.get("Authorization", ""), expected):
        return _error("Not allowed", 401)

    try:
        body = json.loads(request.body)
        email = str(body.get("email", "")).strip()
        password = str(body.get("password", ""))
    except (ValueError, AttributeError):
        return _error("Invalid credentials", 401)
    if not email or not password:
        return _error("Invalid credentials", 401)

    user = User.objects.filter(email__iexact=email).first()
    if user is None or not user.check_password(password):
        return _error("Invalid credentials", 401)
    if not user.is_active:
        return _error("Account is disabled", 403)

    now = timezone.now()
    roles = sorted(set(
        UserRoleMapping.objects
        .filter(user=user, status="approved", valid_from__lte=now)
        .filter(Q(valid_to__isnull=True) | Q(valid_to__gt=now))
        .values_list("role", flat=True)
    ))

    return JsonResponse({
        "status": "success",
        "user": {
            "spoken_user_id": getattr(user, "spk_user_id", None),
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "roles": roles,
        },
    })
```

```python
# in the project's urls.py
from accounts.edupyramids_api import edupyramids_verify_user

urlpatterns += [
    path("api/edupyramids/verify-user/", edupyramids_verify_user),
]
```

```python
# settings.py: a long random value, shared only with the EduPyramids server
EDUPYRAMIDS_API_KEY = os.environ["EDUPYRAMIDS_API_KEY"]
```

## Notes

- **HTTPS only.** The password travels in the request body.
- **Rate limiting.** The EduPyramids app already locks an email out after five
  wrong passwords in 15 minutes. If the site has rate limiting (for example in
  nginx), apply it to this path too.
- **Nothing is stored.** The app keeps no copy of the password or the school
  data; it creates its own account (name, email, role) on first sign-in.
- **Test accounts.** Please share one approved student, one invigilator and one
  school coordinator for testing, before the app goes live.

## On the EduPyramids side

Set two values on the EduPyramids server and restart it:

```
SCHOOL_AUTH_URL=https://school.edupyramids.org/api/edupyramids/verify-user/
SCHOOL_AUTH_API_KEY=<the same shared key>
```

The app maps roles as: `student` → student; `invigilator`, `teacher` →
teacher; `main_school_coord`, `national_coord`, `org_partner` → coordinator.
