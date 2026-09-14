import React, { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import type { Locale } from "date-fns";
import formatDistanceShort from "helpers/formatDistanceShort";
import { deriveDeviceSyncDisplayState, toValidDate } from "../../Overview/photoFrameModel";

export default function NextSyncNotice({
  nextDeviceSync,
  active,
  locale,
}: {
  nextDeviceSync: unknown;
  active: boolean;
  locale?: Locale;
}) {
  const [now, setNow] = useState(() => new Date());
  const date = toValidDate(nextDeviceSync);
  const timestamp = date?.getTime();
  const valid = timestamp !== undefined && Number.isFinite(timestamp);

  useEffect(() => {
    if (!active || !valid) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [active, valid, timestamp]);

  const status = deriveDeviceSyncDisplayState({
    latestImageIsOnDevice: true,
    nextDeviceSync: valid ? date : null,
    now,
  });
  if (status === "updating") return <Trans>Updating now...</Trans>;
  if (status === "current" && date) {
    return (
      <Trans i18nKey="Next sync in {{nextSync}}." values={{
        nextSync: formatDistanceShort(date, now, locale),
      }} />
    );
  }
  return <Trans>The next sync will happen automatically.</Trans>;
}
