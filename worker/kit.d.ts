// `mira:kit` is aliased to the adapter-cloudflare output in wrangler.jsonc.
declare module "mira:kit" {
  const handler: ExportedHandler<Env>;
  export default handler;
}
