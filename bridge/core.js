  const sitePattern = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
  const keyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
  const modes = ["config_download", "api_token", "token_convert"];
  function assert(condition) {
    if (!condition) throw new Error("INVALID_CONFIG");
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function checkKeys(value, allowed, required = []) {
    assert(isObject(value));
    assert(Object.keys(value).every(key => allowed.includes(key)));
    assert(required.every(key => Object.hasOwn(value, key)));
  }

  function isText(value, max = 500) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= max;
  }

  function safeKey(key) {
    return keyPattern.test(key) && !forbiddenKeys.has(key);
  }

  function webUrl(value, httpsOnly = false) {
    assert(isText(value, 2048));
    assert(!/[\s\\\u0000-\u001f]/u.test(value));
    const url = new URL(value);
    assert((httpsOnly ? ["https:"] : ["https:", "http:"]).includes(url.protocol));
    assert(!url.username && !url.password && !url.hash);
    return url;
  }

  export function publicApiUrl(value) {
    const url=webUrl(value,true);
    // DNS names only: URL parsing also normalizes decimal/hex/octal IPv4 forms.
    assert(!url.search && !url.port && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/.test(url.hostname));
    assert(!/(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|onion)$/.test(url.hostname));
    return url;
  }

  // Templates are data trees. References replace whole values without interpolation.
  function validateTemplate(value, fieldNames, allowResponse, depth = 0) {
    assert(depth <= 12);
    if (value === null || ["string", "boolean", "number"].includes(typeof value)) return;
    if (Array.isArray(value)) {
      assert(value.length <= 100);
      value.forEach(item => validateTemplate(item, fieldNames, allowResponse, depth + 1));
      return;
    }
    assert(isObject(value));
    const keys = Object.keys(value);
    assert(keys.length <= 100);
    if (Object.hasOwn(value, "$field")) {
      assert(keys.length === 1 && fieldNames.has(value.$field));
      return;
    }
    if (Object.hasOwn(value, "$response")) {
      assert(allowResponse && keys.length === 1);
      assert(Array.isArray(value.$response) && value.$response.length > 0 && value.$response.length <= 12);
      assert(value.$response.every(key => typeof key === "string" && safeKey(key)));
      return;
    }
    for (const key of keys) {
      assert(safeKey(key));
      validateTemplate(value[key], fieldNames, allowResponse, depth + 1);
    }
  }

  export function validateSite(site, expectedId) {
    checkKeys(site, ["$schema", "siteId", "name", "bridgeUrl", "originLoginUrl", "description", "mode", "filename", "fields", "output", "api", "requireDownloadParam"],
      ["siteId", "name", "bridgeUrl", "originLoginUrl", "description", "mode", "filename", "fields", "output"]);
    assert(site.siteId === expectedId && sitePattern.test(site.siteId) && site.siteId.length <= 43);
    if (Object.hasOwn(site, "$schema")) assert(site.$schema === "./_schema.json");
    assert(isText(site.name, 100) && isText(site.description));
    webUrl(site.bridgeUrl, true);
    webUrl(site.originLoginUrl);
    assert(modes.includes(site.mode));
    assert(typeof site.filename === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}\.json$/.test(site.filename));
    assert(!Object.hasOwn(site, "requireDownloadParam") || typeof site.requireDownloadParam === "boolean");
    assert(Array.isArray(site.fields) && site.fields.length > 0 && site.fields.length <= 20);
    const fieldNames = new Set();
    for (const field of site.fields) {
      checkKeys(field, ["name", "label", "type", "autocomplete", "inputmode", "maxLength"], ["name", "label", "type", "autocomplete"]);
      assert(typeof field.name === "string" && safeKey(field.name) && field.name.length <= 64 && !fieldNames.has(field.name));
      assert(isText(field.label, 100) && ["text", "password"].includes(field.type));
      assert(["username", "current-password", "off"].includes(field.autocomplete));
      assert(field.type !== "password" || field.autocomplete === "current-password");
      assert(field.type !== "text" || field.autocomplete !== "current-password");
      assert(!/password|passwd|token|secret|api_?key|authorization|비밀번호|토큰|인증키/i.test(field.name+' '+field.label)||field.type==='password');
      assert(!Object.hasOwn(field, "inputmode") || ["text", "numeric", "email", "tel"].includes(field.inputmode));
      assert(!Object.hasOwn(field, "maxLength") || (Number.isInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= 16384));
      assert(site.mode !== "token_convert" || field.type === "password");
      fieldNames.add(field.name);
    }
    assert(site.fields.some(field => field.type === "password"));
    assert(isObject(site.output) && Object.keys(site.output).length > 0);
    assert(!Object.hasOwn(site.output, "$field") && !Object.hasOwn(site.output, "$response"));
    validateTemplate(site.output, fieldNames, site.mode === "api_token");
    if (site.mode === "api_token") {
      checkKeys(site.api, ["url", "body"], ["url", "body"]);
      const apiUrl = publicApiUrl(site.api.url);
      assert(!apiUrl.search);
      assert(isObject(site.api.body) && Object.keys(site.api.body).length > 0);
      assert(!Object.hasOwn(site.api.body, "$field") && !Object.hasOwn(site.api.body, "$response"));
      validateTemplate(site.api.body, fieldNames, false);
    } else {
      assert(!Object.hasOwn(site, "api"));
    }
    return site;
  }

export {sitePattern,isObject,assert,forbiddenKeys};
export function selectSite(hostname,search,hosts={}) {
  const host=hostname.toLowerCase();
  const mapped=Object.hasOwn(hosts,host)?hosts[host]:null;
  const legacy=/^pickle-loginbridge--([a-z0-9]+(?:-[a-z0-9]+)+)\.pages\.dev$/.exec(host)?.[1];
  const custom=/^([a-z0-9]+(?:-[a-z0-9]+)+)\.login\.pickle-recipes\.com$/.exec(host)?.[1];
  // Unrecognized nested login hosts never fall back to an attacker-selected query.
  if(host.endsWith('.login.pickle-recipes.com')&&!custom)throw new Error('INVALID_HOST');
  const siteId=mapped||custom||legacy||new URLSearchParams(search).get('site');
  if(siteId)assert(typeof siteId==='string'&&sitePattern.test(siteId)&&siteId.length<=43);
  return {siteId,preview:!mapped&&!custom&&!legacy};
}

