"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Header } from "@/components/Header";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, Card, EmptyState, ErrorBanner, Field, inputClass, Loading } from "@/components/ui";
import { api, ApiError, errorMessage, type Area, type RideRequest } from "@/lib/api";
import { formatPaisa, formatWhen } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePolling } from "@/lib/usePolling";

const POLL_MS = 3000;
const isActive = (r: RideRequest) =>
  r.status === "REQUESTED" || r.status === "MATCHED" || r.status === "IN_PROGRESS";

function statusMessage(r: RideRequest): string {
  if (r.status === "REQUESTED") return "Looking for a driver. This page refreshes every few seconds.";
  if (r.status === "MATCHED") {
    const who = r.driver ? `${r.driver.name}'s ${r.driver.vehicle}` : "your driver";
    return `You have a seat with ${who}. Meet at ${r.pickup_area.name}.`;
  }
  if (r.status === "IN_PROGRESS") return `On the way to ${r.destination_area.name}.`;
  return "";
}

function Route({ request }: { request: RideRequest }) {
  return (
    <span>
      {request.pickup_area.name} <span aria-hidden>→</span>
      <span className="sr-only">to</span> {request.destination_area.name}
    </span>
  );
}

function CurrentRequest({
  request,
  onCancel,
  cancelling,
}: {
  request: RideRequest;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const canCancel = request.status === "REQUESTED" || request.status === "MATCHED";
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Your ride</p>
          <h2 className="text-lg font-semibold">
            <Route request={request} />
          </h2>
          <p className="text-sm text-zinc-500">
            {request.seats} {request.seats === 1 ? "seat" : "seats"}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>

      <p className="mt-3 text-sm text-zinc-700">{statusMessage(request)}</p>

      {request.driver && (
        <p className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-sm">
          Driver <span className="font-medium">{request.driver.name}</span> · {request.driver.vehicle}
        </p>
      )}

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-zinc-500">Estimated fare</dt>
          <dd className="font-medium">{formatPaisa(request.estimated_fare_paisa)}</dd>
        </div>
        {request.final_fare_paisa !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-zinc-500">Final fare</dt>
            <dd className="text-base font-semibold">{formatPaisa(request.final_fare_paisa)}</dd>
          </div>
        )}
      </dl>
      {request.final_fare_paisa === null && (
        <p className="mt-2 text-xs text-zinc-500">
          Share the ride with another passenger and you both pay 20% less when it starts.
        </p>
      )}

      {canCancel && (
        <div className="mt-4">
          <Button variant="danger" onClick={onCancel} disabled={cancelling}>
            {cancelling ? "Cancelling…" : "Cancel request"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function RequestForm({
  areas,
  onCreated,
}: {
  areas: Area[];
  onCreated: (request: RideRequest) => void;
}) {
  const [pickup, setPickup] = useState("");
  const [destination, setDestination] = useState("");
  const [seats, setSeats] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameArea = pickup !== "" && pickup === destination;
  const ready = pickup !== "" && destination !== "" && !sameArea;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await api.requests.create({
          pickup_area_id: Number(pickup),
          destination_area_id: Number(destination),
          seats: Number(seats),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">Request a ride</h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <Field label="Pickup area">
          <select required value={pickup} onChange={(e) => setPickup(e.target.value)} className={inputClass}>
            <option value="">Select an area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destination area">
          <select
            required
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className={inputClass}
          >
            <option value="">Select an area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Seats">
          <select value={seats} onChange={(e) => setSeats(e.target.value)} className={inputClass}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {sameArea && <p className="text-sm text-amber-700">Pickup and destination must be different areas.</p>}
        <ErrorBanner message={error} />
        <Button type="submit" disabled={!ready || busy} className="w-full">
          {busy ? "Requesting…" : "Request ride"}
        </Button>
      </form>
    </Card>
  );
}

function HistoryItem({ request }: { request: RideRequest }) {
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          <Route request={request} />
        </p>
        <p className="text-xs text-zinc-500">
          {request.seats} {request.seats === 1 ? "seat" : "seats"} · {formatWhen(request.created_at)}
          {request.driver && ` · ${request.driver.name}`}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <StatusBadge status={request.status} />
        {request.status === "COMPLETED" && request.final_fare_paisa !== null && (
          <span className="text-sm font-semibold">{formatPaisa(request.final_fare_paisa)}</span>
        )}
      </div>
    </li>
  );
}

export default function PassengerPage() {
  const router = useRouter();
  const { user, error: sessionError } = useSession("PASSENGER");
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [requests, setRequests] = useState<RideRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([api.areas(), api.requests.list()])
      .then(([loadedAreas, loadedRequests]) => {
        if (cancelled) return;
        setAreas(loadedAreas);
        setRequests(loadedRequests);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refresh = useCallback(async () => {
    try {
      setRequests(await api.requests.list());
      setPollError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setPollError(errorMessage(err));
    }
  }, [router]);

  const active = requests?.find(isActive);
  usePolling(refresh, POLL_MS, Boolean(active));

  async function cancel(id: string) {
    setCancelling(true);
    setActionError(null);
    try {
      const updated = await api.requests.cancel(id);
      setRequests((current) => current?.map((r) => (r.id === updated.id ? updated : r)) ?? null);
    } catch (err) {
      setActionError(errorMessage(err));
      void refresh();
    } finally {
      setCancelling(false);
    }
  }

  if (sessionError || loadError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorBanner message={sessionError ?? loadError} />
      </main>
    );
  }
  if (!user || !areas || !requests) return <Loading />;

  const history = requests.filter((r) => r !== active);

  return (
    <>
      <Header user={user} />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
        <ErrorBanner message={pollError && `Connection problem, retrying: ${pollError}`} />
        <ErrorBanner message={actionError} />

        {active ? (
          <CurrentRequest request={active} onCancel={() => void cancel(active.id)} cancelling={cancelling} />
        ) : (
          <RequestForm
            areas={areas}
            onCreated={(created) => setRequests((current) => [created, ...(current ?? [])])}
          />
        )}

        <Card>
          <h2 className="text-lg font-semibold">Your rides</h2>
          {history.length === 0 ? (
            <EmptyState>No rides yet. Completed and cancelled requests show up here.</EmptyState>
          ) : (
            <ul className="mt-1 divide-y divide-zinc-100">
              {history.map((r) => (
                <HistoryItem key={r.id} request={r} />
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
