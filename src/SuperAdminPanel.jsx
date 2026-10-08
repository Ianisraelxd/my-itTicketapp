import AdminTable from "./AdminTable";
import ArchivePanel from "./ArchivePanel";
import useAdminManagement from "./hooks/useAdminManagement";
import useArchive from "./hooks/useArchive";

// Super Admin settings: data archiving and privileged accounts. This component only
// wires the hooks (logic) to the panels (presentation).
export default function SuperAdminPanel({ showMessage }) {
  const archive = useArchive({ onMessage: showMessage });
  const management = useAdminManagement({ onMessage: showMessage });

  return (
    <>
      <ArchivePanel archive={archive} />
      <AdminTable management={management} />
    </>
  );
}
