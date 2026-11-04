import React from 'react';
import { Navigate } from 'react-router';
export default function CalendarPage() {
  return <Navigate to="/tasks?view=timeline&scope=month" replace />;
}
