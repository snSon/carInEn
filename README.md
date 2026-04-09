# pjt5 Quick Run

## 1) Run

```bash
cd functions
npm install
cd ..
```

Open `public/index.html` with a local web server (for example VS Code Live Server).

Create local config files before running:

```bash
copy public\config\app-config.example.js public\config\app-config.js
copy functions\config\runtime-config.example.js functions\config\runtime-config.js
```

`public/config/app-config.js` and `functions/config/runtime-config.js` are ignored by Git.

## 2) Firebase Upload Troubleshooting

If log upload fails with `Missing or insufficient permissions`:

1. Match project IDs
- Frontend: `public/firebase/firebase-config.js` (`projectId`)
- CLI default: `.firebaserc`
- They must be the same.

2. Clear broken proxy env (PowerShell)

```powershell
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:ALL_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:GIT_HTTPS_PROXY -ErrorAction SilentlyContinue
```

3. Deploy Firestore rules to the same project

```bash
firebase.cmd use sample-project-f31db
firebase.cmd deploy --only firestore:rules
```

4. Retry upload on `public/settings/log-manager.html`.

## 3) Notes

- `log-manager.js` now shows project-aware error hints on permission errors.
- It also attempts anonymous auth session initialization before upload/query.
