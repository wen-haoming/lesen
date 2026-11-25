## 变更说明

（用户可见行为、维护者可见 CI/发布影响）

## 检查

- [ ] `pnpm test` / `pnpm typecheck` / `pnpm build` 已在本地或 CI 验证
- [ ] 未提交 secret、`.env.production.local`、私人截图
- [ ] 若改版本：`CHANGELOG.md` 顶节与 `package.json` 一致
- [ ] 若改商店图：仅 `release-screenshots/public/`，保留脱敏与 PROVENANCE

## 发布影响

- [ ] 无（默认）
- [ ] 需要新版本 tag + Release（维护者操作，不在此 PR 自动执行）
- [ ] 影响 CWS / GitHub Actions 管线（说明 workflow 或脚本）