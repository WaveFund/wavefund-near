# Wavefund judging deployment

Frontend: Vercel, root `frontend`, Node22, standard Next.js build. Enable access to source outside the root directory.

Public frontend configuration:

```
NEXT_PUBLIC_DATA_MODE=hybrid
NEXT_PUBLIC_API_URL=https://<actual-service>.onrender.com
```

Hybrid mode reads completed-round evidence from the deployed bundle, independently of backend cold starts. Live state, reputation, fresh receipt checks and configured dry quotes use the HTTPS API. Wallet writes remain browser-signed; the API holds no wallet or AI keys.

Render Free web service, repository root, Node runtime:

- Build: `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`
- Start: `npm run start:hosted`
- Health path: `/api/health`

```
NODE_VERSION=22.23.4
WAVEFUND_HOSTED=1
WAVEFUND_NETWORK=aurora-testnet
WAVEFUND_ALLOWED_ORIGINS=https://wavefund-near.vercel.app
WAVEFUND_TEE_POLICY=docs/tee-policy.json
WAVEFUND_FUNDING=live-preview
```

Render supplies `PORT` and `RENDER_EXTERNAL_HOSTNAME`. For another host, supply its exact hostname in `WAVEFUND_PUBLIC_HOST`. Only explicit HTTPS UI origins are accepted; no wildcard preview-domain allowance is configured. Runtime monitoring uses the Tidepool testnet manifest and six public ABIs in `runtime/abi`, not ignored local build output.

Hosted mode rejects owner preparation, local-demo execution and submitted/signing routes. Existing funding preview requests remain dry and use reviewed network configuration; they are not a claim of funded delivery. No background round automation is deployed. Render Free sleeps when idle and has no persistent disk; this service stores no signing state and bundled round history remains available on Vercel.

Local behavior remains loopback-only by default. A public page cannot fall back to a visitor's localhost when its backend URL is missing or incorrect.

Verification before release: full runtime and frontend regressions, typecheck/build, Host/CORS and denied-route mutations, and a credential-free public-RPC startup smoke test. Verify deployed health/state chain1313161555, round history, reputation, preflight and blocked POST routes after deployment. Do not add wallet/model keys to either hosting provider.
