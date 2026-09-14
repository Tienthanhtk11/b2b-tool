import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Page,
  Select,
  Text,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { listShopLocations } from "../services/item-sync.server";
import { getNetSuiteClient, getNetSuiteMode } from "../services/netsuite/index.server";
import {
  B2B_LOCATION_SETTING_KEY,
  getAppSetting,
  setAppSetting,
} from "../services/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const mode = getNetSuiteMode();
  const locationId = await getAppSetting(B2B_LOCATION_SETTING_KEY);
  let locations: Array<{ id: string; name: string; isActive: boolean }> = [];
  let locationsError: string | null = null;
  try {
    locations = await listShopLocations();
  } catch (error) {
    locationsError =
      error instanceof Error ? error.message : "Unable to load Shopify locations";
  }

  return json({
    mode,
    locationId,
    locations,
    locationsError,
    schedulerEnabled: process.env.ENABLE_SCHEDULER === "true",
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "test-connection") {
      const result = await getNetSuiteClient().testConnection();
      return json({
        connection: result,
        success: result.ok ? result.message ?? "Connection OK" : undefined,
        error: result.ok ? undefined : result.message ?? "Connection failed",
      });
    }
    if (intent === "save-location") {
      const locationId = String(formData.get("locationId") ?? "").trim();
      if (!locationId) {
        return json({ error: "Select a location" }, { status: 400 });
      }
      await setAppSetting(B2B_LOCATION_SETTING_KEY, locationId);
      return json({ success: "Inventory location saved" });
    }
    return json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed";
    return json({ error: message }, { status: 400 });
  }
};

export default function SettingsPage() {
  const { mode, locationId, locations, locationsError, schedulerEnabled } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [selectedLocation, setSelectedLocation] = useState(locationId ?? "");

  const submittingIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData && "success" in actionData && actionData.success) {
      shopify.toast.show(actionData.success);
    }
  }, [actionData, shopify]);

  const locationOptions = [
    { label: "Select a location", value: "" },
    ...locations.map((location) => ({
      label: `${location.name}${location.isActive ? "" : " (inactive)"}`,
      value: location.id,
    })),
  ];

  return (
    <Page title="Settings">
      <TitleBar title="Settings" />
      <BlockStack gap="400">
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title="Action failed">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {locationsError && (
          <Banner tone="warning" title="Could not load locations">
            <p>{locationsError}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              NetSuite
            </Text>
            <InlineBadge mode={mode} />
            <Text as="p" variant="bodySm" tone="subdued">
              Mode is controlled by the NETSUITE_MODE environment variable
              (mock | rest). REST credentials are never stored in the database.
            </Text>
            <Button
              loading={isSubmitting && submittingIntent === "test-connection"}
              onClick={() => submit({ intent: "test-connection" }, { method: "post" })}
            >
              Test connection
            </Button>
            {actionData && "connection" in actionData && actionData.connection && (
              <Banner tone={actionData.connection.ok ? "success" : "critical"}>
                <p>{actionData.connection.message}</p>
              </Banner>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Inventory location (b2b-site)
            </Text>
            <Select
              label="Shopify location"
              options={locationOptions}
              value={selectedLocation}
              onChange={setSelectedLocation}
              helpText="Used by inventorySetQuantities when syncing NetSuite quantities."
            />
            <Button
              variant="primary"
              disabled={!selectedLocation}
              loading={isSubmitting && submittingIntent === "save-location"}
              onClick={() =>
                submit(
                  { intent: "save-location", locationId: selectedLocation },
                  { method: "post" },
                )
              }
            >
              Save location
            </Button>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">
              Scheduler
            </Text>
            <Text as="p">
              Automatic sync every 15 minutes is{" "}
              {schedulerEnabled ? "enabled" : "disabled"}.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Set ENABLE_SCHEDULER=true in the environment to start the node-cron
              job from the Remix server entry. The job skips if a matching SyncRun
              is already RUNNING.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}

function InlineBadge({ mode }: { mode: string }) {
  return (
    <Badge tone={mode === "rest" ? "success" : "info"}>
      {mode === "rest" ? "REST" : "Mock fixtures"}
    </Badge>
  );
}
