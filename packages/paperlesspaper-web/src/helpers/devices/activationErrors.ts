export const isTemporaryActivationError = (error: any) => {
  const status =
    error?.status === "PARSING_ERROR" ? error.originalStatus : error?.status;
  return [502, 503, 504, "FETCH_ERROR", "TIMEOUT_ERROR"].includes(status);
};

export function activationErrorMessage(error: any) {
  if (error?.status === 401) {
    return "Please sign in again to set up your frame.";
  }
  if (error?.status === 403) {
    return "You do not have access to this organization. Select an organization you belong to, or ask its administrator for access.";
  }
  if (isTemporaryActivationError(error)) {
    return "We could not confirm the activation. Check your internet connection and try again. You do not need to reset your frame.";
  }
  return "We could not set up your frame. Please try again or contact support with your device ID.";
}
