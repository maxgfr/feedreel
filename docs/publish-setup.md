# Social publishing setup

Step-by-step guide to obtain the credentials that let `feedreel`
automatically publish to **YouTube**, **TikTok** and **Instagram Reels**.

> Follow the sections in order. You can enable a single platform only:
> without credentials, each platform is simply **skipped cleanly**.

---

## 1. Overview

Publishing is **opt-in**: by default, the pipeline generates the videos but
posts nothing. Three principles:

- **Secrets live in `.env`** (tokens, API keys, refresh tokens). This
  file is **gitignored and must NEVER be committed**. Copy the provided
  template:

  ```bash
  cp .env.example .env
  ```

- **Non-sensitive configuration lives in `config/publish.yaml`** (active
  platforms, default privacy, TikTok mode, hosting, per-language hashtags).
  This file is **optional**: when absent, automatic publishing in the daily
  job is disabled (`enabled: false`). Copy the template:

  ```bash
  cp config/publish.yaml.example config/publish.yaml
  ```

- **Activation happens at two levels**:
  - `enabled: true` in `config/publish.yaml` → allows automatic publishing
    in the daily job (launchd).
  - The explicit `pnpm feedreel publish` command stays usable even with
    `enabled: false`.

### Multilingual reminder: `_<LANG>` suffix

To post **FR** and **EN** to **different accounts**, any secret can be
suffixed with an **UPPERCASE** language code. The suffixed variable takes
**priority** over the base variable:

```
1. ${NAME}_${LANG}   → e.g. YT_REFRESH_TOKEN_EN   (priority)
2. ${NAME}            → e.g. YT_REFRESH_TOKEN      (fallback)
```

> **Example**: for an English category, `YT_REFRESH_TOKEN_EN` wins over
> `YT_REFRESH_TOKEN`. If you publish everything to a single account, define
> only the **base** (`YT_REFRESH_TOKEN`). An empty value is treated as absent.

This fallback applies to **all** publishing secrets (YouTube, TikTok,
Instagram). Hosting settings (R2 / S3) are shared and do **not** use this
fallback.

---

## 2. YouTube (YouTube Data API v3)

Target variables: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.

### 2.1 Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. At the top, **create a new project** (e.g. `feedreel`).

### 2.2 Enable the API

1. Menu → **APIs & Services → Library**.
2. Search for **YouTube Data API v3** → **Enable**.

### 2.3 Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**.
3. Fill in the app name, support email, developer email.
4. Add the scope **`https://www.googleapis.com/auth/youtube.upload`**.
5. **IMPORTANT — move the app to "Production"** (*Publish app* button).

   > In **Testing** mode, the `refresh_token` **expires after 7 days**,
   > which breaks automatic publishing. In **Production**, it is durable.

### 2.4 Create a "Desktop app" OAuth credential

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Desktop app**.
3. Grab the **Client ID** and the **Client secret** → these are
   `YT_CLIENT_ID` and `YT_CLIENT_SECRET`.

### 2.5 Obtain the refresh token

The `refresh_token` is obtained in **two steps**: (a) user consent that
returns a `code`, then (b) the `code → token` exchange.

#### Option A — OAuth Playground (fast, no code)

1. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/).
2. Click the gear (⚙) at the top right → check **Use your own OAuth
   credentials** → paste `YT_CLIENT_ID` / `YT_CLIENT_SECRET`.

   > In Google Cloud, add the redirect URI
   > `https://developers.google.com/oauthplayground` to your OAuth client.

3. In **Step 1**, enter the scope:
   `https://www.googleapis.com/auth/youtube.upload` → **Authorize APIs**.
4. Sign in with the account of the **target YouTube channel** and accept.
5. In **Step 2**, click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** → `YT_REFRESH_TOKEN`.

#### Option B — Small `google-auth-library` script (already in the dependencies)

```ts
// scripts/yt-refresh-token.ts  — run with: npx tsx scripts/yt-refresh-token.ts
import { OAuth2Client } from 'google-auth-library';
import readline from 'node:readline/promises';

const oauth2 = new OAuth2Client(
  process.env.YT_CLIENT_ID,
  process.env.YT_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob', // or http://localhost if you prefer a redirect
);

const url = oauth2.generateAuthUrl({
  access_type: 'offline',          // required to receive a refresh_token
  prompt: 'consent',               // forces the delivery of the refresh_token
  scope: ['https://www.googleapis.com/auth/youtube.upload'],
});

console.log('1. Open this URL, sign in, accept:\n', url, '\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = await rl.question('2. Paste the code you obtained: ');
rl.close();

const { tokens } = await oauth2.getToken(code.trim());
console.log('\nYT_REFRESH_TOKEN=' + tokens.refresh_token);
```

Then fill in `.env`:

```env
YT_CLIENT_ID=...
YT_CLIENT_SECRET=...
YT_REFRESH_TOKEN=...
```

### 2.6 Quota and Shorts

- `videos.insert` costs **~1600 units**. The default quota is
  **10,000 units/day**, i.e. **about 6 videos/day**.
- **Shorts are detected automatically**: a **vertical** video of duration
  **≤ 3 min**. No specific config setting needed.

---

## 3. TikTok (Content Posting API)

Target variable: `TIKTOK_ACCESS_TOKEN`.

### 3.1 Create an app

1. Go to [developer.tiktok.com](https://developer.tiktok.com/) → **Manage apps
   → Connect an app**.
2. Enable the **Content Posting API** product.

### 3.2 Choose the scopes

| Scope            | Mode      | Availability                                              |
| ---------------- | --------- | -------------------------------------------------------- |
| `video.upload`   | **inbox** | Available **without app review**                         |
| `video.publish`  | **direct**| Requires the **app review** by TikTok                    |

### 3.3 inbox vs direct

- **`inbox` (draft)**: the video is sent to the **inbox** of the user's
  TikTok app; they finalize and publish it manually.
  **No review required** → ideal to get started.
- **`direct` (direct publishing)**: posts directly. **Requires the app
  review**. As long as the app is **not reviewed**, direct posts are forced
  to **`SELF_ONLY`** (visible only to you).

### 3.4 Obtain the token and set the mode

1. Get an **`access_token`** via TikTok's OAuth flow → `TIKTOK_ACCESS_TOKEN`.
2. Choose the mode in `config/publish.yaml`:

   ```yaml
   platforms:
     tiktok:
       enabled: true
       mode: inbox      # inbox = draft (no review); direct = public (review required)
   ```

```env
TIKTOK_ACCESS_TOKEN=...
```

---

## 4. Instagram Reels (Instagram Graph API)

Target variables: `IG_USER_ID`, `IG_ACCESS_TOKEN`.

### 4.1 Account prerequisites

- An Instagram **Business** or **Creator** account.
- This account must be **linked to a Facebook Page**.

### 4.2 Create a Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com/) →
   **My Apps → Create App**.
2. Add the **Instagram Graph API** / **Facebook Login** products.

### 4.3 `instagram_content_publish` permission

- In **production**, this permission requires Meta's **App Review**.
- In **development**, no review is needed: **add your account as a
  tester** (*Tester* / *Instagram Tester* role) and accept the invitation.

### 4.4 Obtain IG_USER_ID + long-lived token

1. Generate a **long-lived token (~60 days)** via the API
   (`oauth/access_token?grant_type=fb_exchange_token`). **Remember to
   refresh it** before it expires.
2. Get the **Instagram account ID** (`IG_USER_ID`) via the linked Page
   (`/me/accounts` then the `instagram_business_account` field).

```env
IG_USER_ID=...
IG_ACCESS_TOKEN=...
```

### 4.5 Important constraint: public hosting required

> **Meta does not receive the file via direct upload**: it **downloads the
> MP4 from a public HTTPS URL** that you provide. So you must **host** the
> video (see section 5 — Cloudflare R2). Without hosting, Instagram
> publishing fails.

---

## 5. Cloudflare R2 (public HTTPS hosting)

Required by Instagram (and useful to share). Target variables:
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
`R2_PUBLIC_BASE_URL`.

### 5.1 Create a bucket

1. Cloudflare Dashboard → **R2 → Create bucket** (e.g. `feedreel`).

### 5.2 Enable public access

- Simple option: **Settings → Public access → Allow** → you get a
  **`https://pub-xxxx.r2.dev`** domain.
- Clean option: connect a **custom domain** (e.g. `cdn.example.com`).
- This URL (without a trailing `/`) becomes `R2_PUBLIC_BASE_URL`.

### 5.3 Create an S3 API token

1. **R2 → Manage R2 API Tokens → Create API token** (permissions
   *Object Read & Write* on the bucket).
2. Grab the **Access Key ID** and the **Secret Access Key**.
3. The **Account ID** is shown on the R2 home page.

```env
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=feedreel
R2_PUBLIC_BASE_URL=https://pub-xxxx.r2.dev
```

And in `config/publish.yaml`:

```yaml
hosting:
  provider: r2          # r2 | s3
  bucket: ""            # or via env R2_BUCKET
  publicBaseUrl: ""     # or via env R2_PUBLIC_BASE_URL
```

### 5.4 AWS S3 variant

Since R2 is **S3-compatible**, you can use AWS S3 instead. Set
`hosting.provider: s3` and fill in:

```env
S3_REGION=...
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=...
S3_PUBLIC_BASE_URL=https://...
```

---

## 5bis. Token longevity & fully automated runs

For a **hands-off daily job**, token lifetime matters:

| Platform | Token | Lifetime | To be 100% automatic |
| --- | --- | --- | --- |
| **YouTube** | OAuth refresh token | **permanent** (app in Production) | ✅ nothing to do — the access token is renewed on each call |
| **TikTok** | access token | **~24 h** | Provide `TIKTOK_CLIENT_KEY` + `TIKTOK_CLIENT_SECRET` + `TIKTOK_REFRESH_TOKEN` → auto refresh |
| **Instagram** | long-lived token | **~60 d** | Provide `FB_APP_ID` + `FB_APP_SECRET` → auto re-exchange before expiry |

**How it works.** If the refresh credentials are present, the pipeline
exchanges a fresh token at publish time and **persists** it in a local,
**gitignored** store (`cache/publish/tokens.json`, never committed). Otherwise,
it uses the static token from `.env` (which you then have to renew by hand
before it expires).

- **TikTok**: get `client_key`/`client_secret` from your TikTok app page, and a
  `refresh_token` during the OAuth flow (valid ~365 d, rotated automatically on each refresh).
- **Instagram**: `FB_APP_ID`/`FB_APP_SECRET` come from your Meta app; the
  initial long-lived token (`IG_ACCESS_TOKEN`) acts as a seed, then it is re-exchanged on its own.

> Without these refresh credentials, **nothing breaks**: YouTube stays 100% automatic,
> TikTok/Instagram work with their static token until it expires.

---

## 6. Verification

1. **Generate the metadata (titles, descriptions, hashtags)** for the date:

   ```bash
   pnpm feedreel captions --date 2026-06-06
   ```

   Writes the metadata cache (`cache/metadata`).

2. **Dry run** (no network call, shows the posts that *would* be sent):

   ```bash
   pnpm feedreel publish --date 2026-06-06 --dry-run
   ```

   Check titles, hashtags, privacy, hosting URL.

3. **Real publishing**: once the credentials are in place, drop
   `--dry-run`:

   ```bash
   pnpm feedreel publish --date 2026-06-06
   ```

> **Reminder**: without credentials for a platform, it is **skipped
> cleanly** (no blocking error). So you can start with a single platform
> and add the rest later.

---

## `.env` variables summary by platform

| Platform              | `.env` variables                                                                                  | `_<LANG>` fallback | Notes                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------- | :-------------: | -------------------------------------------------------------------- |
| **YouTube**           | `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`                                             |       Yes       | OAuth app in **Production**, scope `youtube.upload`                   |
| **TikTok**            | `TIKTOK_ACCESS_TOKEN` *(or refresh: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`)* |  Yes  | Token ~24 h; auto refresh if client/refresh provided (§5bis)         |
| **Instagram Reels**   | `IG_USER_ID`, `IG_ACCESS_TOKEN` *(auto refresh: `FB_APP_ID`, `FB_APP_SECRET`)*                     |       Yes       | Token ~60 d, auto re-exchanged if Meta app provided; **hosting required** |
| **Cloudflare R2**     | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`    |  No (shared)  | Public HTTPS hosting (required by Instagram)                      |
| **AWS S3** (variant)  | `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`         |  No (shared)  | Alternative to R2 (`hosting.provider: s3`)                            |

> **Multilingual**: to publish FR and EN to separate accounts,
> duplicate the variable with the language suffix, e.g.
> `YT_REFRESH_TOKEN_EN`, `TIKTOK_ACCESS_TOKEN_EN`, `IG_ACCESS_TOKEN_EN`.
> The suffixed variable takes precedence; otherwise the base is used.
