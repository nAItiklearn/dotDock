import { NativeGate } from "../ui/native";
import { PageHeader } from "../ui/layout";
import { ModulesSection, useModulesResource } from "../ui/ModuleSwitch";
import { pageById } from "../pageMeta";

export function ModulesPage() {
  const resource = useModulesResource();
  const page = pageById("modules");
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <NativeGate
        resource={resource}
        icon="settings"
        offers={[
          "Turn the home screen, the dock, the taskbar replacement and the notch on or off, each by itself.",
          "See at once whether a part is running, and why one did not start.",
          "Get the Windows taskbar back the moment the replacement is switched off.",
        ]}
      >
        {() => <ModulesSection />}
      </NativeGate>
    </>
  );
}
