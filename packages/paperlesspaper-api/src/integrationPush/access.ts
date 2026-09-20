import { ApiError, User } from "@internetderdinge/api";
import Paper from "../papers/papers.model.js";
import { hash, validatePublicUrl } from "./security.js";

export function integrationIdentity(paper: any) {
  if (paper?.kind !== "plugin") throw new Error("Open Integration required");
  const config = new URL(paper.meta?.pluginConfigUrl);
  const manifest = paper.meta?.pluginManifest;
  const capability = manifest?.capabilities?.contentPush;
  if (!capability || typeof capability.callbackPath !== "string")
    throw new Error("Content push capability required");
  const render = new URL(
    paper.meta?.pluginRenderPage || manifest.renderPage,
    config
  );
  const settings = new URL(
    paper.meta?.pluginSettingsPage || manifest.settingsPage,
    config
  );
  const callback = new URL(capability.callbackPath, config);
  for (const url of [config, render, settings, callback]) {
    validatePublicUrl(url);
    if (url.origin !== config.origin)
      throw new Error("Integration endpoints must have the same origin");
  }
  return {
    source: hash(
      [config.href, render.href, settings.href, callback.href].join("\n")
    ),
    callbackUrl: callback.href,
    configUrl: config.href,
    renderUrl: render.href,
    settingsUrl: settings.href,
  };
}

export async function authorizedPaper(owner: string, paperId: string) {
  if (!owner || !/^[a-f\d]{24}$/i.test(paperId))
    throw new ApiError(403, "Paper access denied");
  const paper = await Paper.findById(paperId);
  if (
    !paper?.organization ||
    !(await User.exists({ owner, organization: paper.organization }))
  )
    throw new ApiError(403, "Paper access denied");
  try {
    return { paper, identity: integrationIdentity(paper) };
  } catch {
    throw new ApiError(400, "Invalid push integration configuration");
  }
}

export async function authorizeConnection(connection: any) {
  if (!connection || connection.revoked || !connection.generation)
    throw new ApiError(401, "Connection revoked");
  const { paper, identity } = await authorizedPaper(
    connection.owner,
    String(connection.paperId)
  );
  if (
    String(paper.organization) !== String(connection.organization) ||
    identity.source !== connection.source
  )
    throw new ApiError(403, "Integration configuration changed; reconnect");
  return paper;
}
