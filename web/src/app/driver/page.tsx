"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/Header";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, cx, EmptyState, ErrorBanner, Loading } from "@/components/ui";
import {
  api,
  ApiError,
  errorMessage,
  type DriverRequest,
  type PastRide,
  type Ride,
} from "@/lib/api";
import { formatWhen } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 3000;

type RideAction = "arrive" | "start" | "complete" | "cancel";

// Only the moves the ride can actually make from its current status.
const ACTIONS: Record<Ride["status"], { action: RideAction; label: string; danger?: boolean }[]> = {
  OPEN: [
    { action: "arrive", label: "Arrive" },
    { action: "cancel", label: "Cancel ride", danger: true },
  ],
  DRIVER_ARRIVED: [
    { action: "start", label: "Start" },
    { action: "cancel", label: "Cancel ride", danger: true },
  ],
  STARTED: [{ action: "complete", label: "Complete" }],
  COMPLETED: [],
  CANCELLED: [],
};

interface Dashboard {
  ride: Ride | null;
  past: PastRide[];
  open: DriverRequest[];
  serverSaysOffline: boolean;
}

// No state in here: it only fetches, so effects can apply the result from a promise callback.
async function fetchDashboard(isOnline: boolean): Promise<Dashboard> {
  const [ride, past] = await Promise.all([api.driver.ride(), api.driver.rides()]);
  let open: DriverRequest[] = [];
  let serverSaysOffline = false;
  if (isOnline && !ride) {
    try {
      open = await api.driver.requests();
    } catch (err) {
      if (err instanceof ApiError && err.code === "DRIVER_OFFLINE") serverSaysOffline = true;
      else throw err;
    }
  }
  return { ride, past, open, serverSaysOffline };
}

function SeatIndicator({ occupied, capacity }: { occupied: number; capacity: number }) {
  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={`${occupied} of ${capacity} seats taken`} className="flex gap-1.5">
        {Array.from({ length: capacity }, (_, i) => (
          <span
            key={i}
            data-filled={i < occupied}
            className={cx(
              "h-8 w-8 rounded-md border-2",
              i < occupied ? "border-zinc-900 bg-zinc-900" : "border-dashed border-zinc-300 bg-white",
            )}
          />
        ))}
      </div>
      <span className="text-sm text-zinc-600">
        {occupied} of {capacity} seats taken
      </span>
    </div>
  );
}

function ActiveRide({
  ride,
  busy,
  onAction,
}: {
  ride: Ride;
  busy: string | null;
  onAction: (action: RideAction) => void;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Current ride</p>
          <h2 className="text-lg font-semibold">Pickup: {ride.pickup_area.name}</h2>
          <p className="text-sm text-zinc-500">{ride.vehicle_name}</p>
        </div>
        <StatusBadge status={ride.status} />
      </div>

      <div className="mt-4">
        <SeatIndicator occupied={ride.seats_occupied} capacity={ride.capacity} />
      </div>

      <h3 className="mt-5 text-sm font-semibold text-zinc-700">Passengers</h3>
      {ride.passengers.length === 0 ? (
        <EmptyState>No passengers on this ride right now.</EmptyState>
      ) : (
        <ul className="mt-1 divide-y divide-zinc-100">
          {ride.passengers.map((p) => (
            <li key={p.request_id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{p.passenger_name}</p>
                <p className="text-xs text-zinc-500">
                  {p.seats} {p.seats === 1 ? "seat" : "seats"} to {p.destination_area.name}
                </p>
              </div>
              <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      )}

      {ACTIONS[ride.status].length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {ACTIONS[ride.status].map(({ action, label, danger }) => (
            <Button
              key={action}
              variant={danger ? "danger" : "primary"}
              disabled={busy !== null}
              onClick={() => onAction(action)}
            >
              {busy === action ? "Working…" : label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

function OpenRequests({
  requests,
  busy,
  onAccept,
}: {
  requests: DriverRequest[];
  busy: string | null;
  onAccept: (id: string) => void;
}) {
  return (
    <Card>
      <h2 className="text-lg font-semibold">Ride requests</h2>
      {requests.length === 0 ? (
        <EmptyState>No open requests right now. New ones appear here automatically.</EmptyState>
      ) : (
        <ul className="mt-1 divide-y divide-zinc-100">
          {requests.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {r.passenger_name} · {r.seats} {r.seats === 1 ? "seat" : "seats"}
                </p>
                <p className="text-sm text-zinc-600">
                  {r.pickup_area.name} <span aria-hidden>→</span>
                  <span className="sr-only">to</span> {r.destination_area.name}
                </p>
                <p className="text-xs text-zinc-500">{formatWhen(r.created_at)}</p>
              </div>
              <Button disabled={busy !== null} onClick={() => onAccept(r.id)}>
                {busy === `accept:${r.id}` ? "Accepting…" : "Accept"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DriverPage() {
  const router = useRouter();
  const { user, error: sessionError } = useSession("DRIVER");
  const [onlineOverride, setOnlineOverride] = useState<boolean | null>(null);
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [openRequests, setOpenRequests] = useState<DriverRequest[]>([]);
  const [past, setPast] = useState<PastRide[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const online = onlineOverride ?? user?.is_online ?? false;

  const apply = useCallback((d: Dashboard) => {
    setRide(d.ride);
    setPast(d.past);
    setOpenRequests(d.open);
    if (d.serverSaysOffline) setOnlineOverride(false);
  }, []);

  const load = useCallback(
    async (isOnline: boolean) => apply(await fetchDashboard(isOnline)),
    [apply],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchDashboard(user.is_online)
      .then((d) => {
        if (!cancelled) apply(d);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user, apply]);

  const refresh = useCallback(async () => {
    try {
      await load(online);
      setPollError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setPollError(errorMessage(err));
    }
  }, [load, online, router]);

  usePolling(refresh, POLL_MS, ride !== undefined);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(errorMessage(err));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const toggleOnline = () =>
    run("online", async () => {
      const result = online ? await api.driver.goOffline() : await api.driver.goOnline();
      setOnlineOverride(result.is_online);
      await load(result.is_online);
    });

  const accept = (id: string) =>
    run(`accept:${id}`, async () => {
      await api.driver.accept(id);
      await load(online);
    });

  const moveRide = (action: RideAction) =>
    run(action, async () => {
      await api.driver[action]();
      await load(online);
    });

  if (sessionError || loadError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorBanner message={sessionError ?? loadError} />
      </main>
    );
  }
  if (!user || ride === undefined || past === null) return <Loading />;

  return (
    <>
      <Header user={user} />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        <ErrorBanner message={pollError && `Connection problem, retrying: ${pollError}`} />
        <ErrorBanner message={actionError} />

        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-lg font-semibold">
                <span
                  aria-hidden
                  className={cx("h-2.5 w-2.5 rounded-full", online ? "bg-emerald-500" : "bg-zinc-300")}
                />
                You are {online ? "online" : "offline"}
              </p>
              {ride && online && (
                <p className="text-sm text-zinc-500">Finish or cancel your ride to go offline.</p>
              )}
            </div>
            <Button
              variant={online ? "secondary" : "primary"}
              className="shrink-0"
              disabled={busy !== null || (online && ride !== null)}
              onClick={() => void toggleOnline()}
            >
              {busy === "online" ? "Working…" : online ? "Go offline" : "Go online"}
            </Button>
          </div>
        </Card>

        {ride ? (
          <ActiveRide ride={ride} busy={busy} onAction={(action) => void moveRide(action)} />
        ) : online ? (
          <OpenRequests requests={openRequests} busy={busy} onAccept={(id) => void accept(id)} />
        ) : (
          <Card>
            <p className="text-sm text-zinc-600">
              You are offline, so passengers cannot be matched with you. Go online to see open ride
              requests and accept one; your ride will then appear here.
            </p>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-semibold">Past rides</h2>
          {past.length === 0 ? (
            <EmptyState>No finished rides yet. Completed and cancelled rides show up here.</EmptyState>
          ) : (
            <ul className="mt-1 divide-y divide-zinc-100">
              {past.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Pickup: {r.pickup_area.name}</p>
                    <p className="text-xs text-zinc-500">
                      {r.passenger_count} {r.passenger_count === 1 ? "passenger" : "passengers"} ·{" "}
                      {r.seats_used} {r.seats_used === 1 ? "seat" : "seats"} · {formatWhen(r.created_at)}
                    </p>
                  </div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
