import { useOutletContext } from "react-router-dom";
import AdminFatturazione from "@/pages/admin/Fatturazione";

export default function ControlBilling(){const context=useOutletContext();return <AdminFatturazione clientMode={!context.isStaff} forcedClienteId={context.clientId || ""}/>;}
