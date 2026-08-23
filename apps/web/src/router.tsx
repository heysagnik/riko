import { createBrowserRouter } from "react-router-dom";
import { LandingPage } from "./routes/landing/landing-page.js";
import { UnsubscribePage } from "./routes/public/unsubscribe-page.js";
import { PayPage } from "./routes/public/pay-page.js";
import { SignInPage } from "./routes/auth/sign-in-page.js";
import { SignUpPage } from "./routes/auth/sign-up-page.js";
import { OnboardingPage } from "./routes/auth/onboarding-page.js";
import { RequireAuth } from "./routes/require-auth.js";
import { RequireSession } from "./routes/require-session.js";
import { DashboardLayout } from "./routes/dashboard/dashboard-layout.js";
import { OverviewPage } from "./routes/dashboard/overview-page.js";
import { CaseListPage } from "./routes/dashboard/case-list-page.js";
import { CaseDetailPage } from "./routes/dashboard/case-detail-page.js";
import { ExceptionsPage } from "./routes/dashboard/exceptions-page.js";
import { ConnectionsPage } from "./routes/dashboard/connections-page.js";
import { SettingsPage } from "./routes/dashboard/settings-page.js";

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/unsubscribe/:customerId", element: <UnsubscribePage /> },
  { path: "/pay/:caseId", element: <PayPage /> },
  { path: "/sign-in", element: <SignInPage /> },
  { path: "/sign-up", element: <SignUpPage /> },
  {
    path: "/onboarding",
    element: <RequireSession />,
    children: [{ index: true, element: <OnboardingPage /> }],
  },
  {
    path: "/dashboard",
    element: <RequireAuth />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: "cases", element: <CaseListPage /> },
          { path: "cases/:caseId", element: <CaseDetailPage /> },
          { path: "exceptions", element: <ExceptionsPage /> },
          { path: "connections", element: <ConnectionsPage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
