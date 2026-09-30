# Dhaka Tesla Pool
Share a seat. Split the fare. Survive Dhaka traffic.
(Full documentation in progress.)

## Screenshots

The pooled ride from start to finish: Nusrat asks for a ride, Jashim accepts it in his Bullet, Rafiq asks for the same pickup and joins automatically, and after the ride each passenger sees only their own pooled fare (৳68.00 and ৳56.00).

| | |
|---|---|
| ![Login](docs/screenshots/01-login.png) | ![Nusrat requests a ride](docs/screenshots/02-passenger-request.png) |
| **1. Login**, with quick-login buttons for the demo cast | **2. Nusrat's request** waits for a driver |
| ![Rafiq is matched](docs/screenshots/03-passenger-matched.png) | ![Driver sees open requests](docs/screenshots/04-driver-requests.png) |
| **3. Rafiq joins the open ride** and is matched straight away | **4. Jashim's open requests**, each with an Accept button |
| ![Pooled ride on the driver's screen](docs/screenshots/05-driver-active-ride.png) | ![Nusrat's completed fare](docs/screenshots/06-passenger-completed.png) |
| **5. The pooled ride**: 2 of Bullet's 3 seats taken | **6. Nusrat's completed ride**: ৳68.00 |

On a phone (390px wide):

| | | |
|---|---|---|
| ![Login on a phone](docs/screenshots/mobile-login.png) | ![Driver on a phone](docs/screenshots/mobile-driver-active-ride.png) | ![Passenger on a phone](docs/screenshots/mobile-passenger-completed.png) |

The screenshots are produced by the end-to-end smoke test (`cd web && npm run test:e2e`), which needs Postgres up and a seeded database. Running it again regenerates them.
