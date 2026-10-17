// Deploy entry: the SvelteKit worker plus the Durable Object classes it binds.
import kit from "mira:kit";

export { Directory } from "./directory";
export { Space } from "./space";
export default kit satisfies ExportedHandler<Env>;
