import { logout } from "../../../server/monitoring-auth";
import { handler } from "../../../server/http";
export default handler("POST", async (request) => logout(request));
