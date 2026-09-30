export type Role = "PASSENGER" | "DRIVER";
export type RequestStatus = "REQUESTED" | "MATCHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type RideStatus = "OPEN" | "DRIVER_ARRIVED" | "STARTED" | "COMPLETED" | "CANCELLED";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Me extends SessionUser {
  is_online: boolean;
}

export interface Area {
  id: number;
  name: string;
}

export interface RideRequest {
  id: string;
  status: RequestStatus;
  seats: number;
  pickup_area: Area;
  destination_area: Area;
  estimated_fare_paisa: number;
  final_fare_paisa: number | null;
  ride_id: string | null;
  created_at: string;
  driver: { name: string; vehicle: string } | null;
}

export interface NewRequest {
  pickup_area_id: number;
  destination_area_id: number;
  seats: number;
}

export interface DriverRequest {
  id: string;
  passenger_name: string;
  seats: number;
  pickup_area: Area;
  destination_area: Area;
  created_at: string;
}

export interface RidePassenger {
  request_id: string;
  passenger_name: string;
  seats: number;
  destination_area: Area;
  status: RequestStatus;
}

export interface Ride {
  id: string;
  status: RideStatus;
  capacity: number;
  seats_occupied: number;
  pickup_area: Area;
  vehicle_name: string;
  passengers: RidePassenger[];
}

export interface PastRide {
  id: string;
  status: RideStatus;
  pickup_area: Area;
  vehicle_name: string;
  passenger_count: number;
  seats_used: number;
  created_at: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error as { code?: string; message?: string } | undefined;
    throw new ApiError(
      res.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("POST", "/auth/login", { email, password }).then((r) => r.user),
  signup: (name: string, email: string, password: string) =>
    request<{ user: SessionUser }>("POST", "/auth/signup", { name, email, password }).then(
      (r) => r.user,
    ),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<{ user: Me }>("GET", "/auth/me").then((r) => r.user),

  areas: () => request<Area[]>("GET", "/areas"),

  requests: {
    list: () => request<RideRequest[]>("GET", "/requests"),
    create: (body: NewRequest) => request<RideRequest>("POST", "/requests", body),
    cancel: (id: string) => request<RideRequest>("POST", `/requests/${id}/cancel`),
  },

  driver: {
    goOnline: () => request<{ is_online: boolean }>("POST", "/driver/online"),
    goOffline: () => request<{ is_online: boolean }>("POST", "/driver/offline"),
    requests: () => request<DriverRequest[]>("GET", "/driver/requests"),
    accept: (requestId: string) => request<Ride>("POST", `/driver/requests/${requestId}/accept`),
    ride: () => request<Ride | null>("GET", "/driver/ride"),
    rides: () => request<PastRide[]>("GET", "/driver/rides"),
    arrive: () => request<Ride>("POST", "/driver/ride/arrive"),
    start: () => request<Ride>("POST", "/driver/ride/start"),
    complete: () => request<Ride>("POST", "/driver/ride/complete"),
    cancel: () => request<Ride>("POST", "/driver/ride/cancel"),
  },
};
