import { useCallback, useEffect, useRef, useState } from "react";

const WINDOW_MS = 300_000;
const POLL_MS = 4_000;

export function useDeviceActivation(register: any, organization?: string) {
  const [response, setResponse] = useState<any>();
  const [error, setError] = useState<any>();
  const [time, setTime] = useState(300);
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deadline = useRef<number | undefined>(undefined);
  const request = useRef<any>(undefined);
  const registerRef = useRef(register);
  registerRef.current = register;

  const cancel = useCallback(() => {
    run.current += 1;
    clearTimeout(timer.current);
    deadline.current = undefined;
    request.current = undefined;
    setResponse(undefined);
    setError(undefined);
    setTime(300);
  }, []);

  useEffect(() => {
    cancel();
    return () => {
      run.current += 1;
      clearTimeout(timer.current);
    };
  }, [organization, cancel]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (deadline.current) {
        setTime(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
      }
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const accept = (data: any) => {
    // E-paper success is a server-verified, persisted registration. A raw IoT
    // success (including responses from an older backend) must not finish it.
    if (
      request.current?.id.startsWith("epd") &&
      data.activation_status === "success" &&
      (!data.registrationCompleted || !data.createdDevice?.id)
    ) {
      data = {
        activation_status: "error",
        message: "Device ownership could not be confirmed",
      };
    }
    setResponse({ data });
    return data;
  };

  const schedule = (attempt: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (attempt !== run.current || !request.current) return;
      try {
        const data = await registerRef
          .current({
            ...request.current,
            body: { ...request.current.body, enable: false },
          })
          .unwrap();
        if (attempt !== run.current) return;
        const result = accept(data);
        setError(undefined);
        if (
          ["pending", "device_confirmed"].includes(result.activation_status)
        ) {
          if (Date.now() > deadline.current!) {
            accept({ activation_status: "timeout" });
          } else {
            schedule(attempt);
          }
        }
      } catch (failure) {
        if (attempt !== run.current) return;
        if (Date.now() <= deadline.current!) schedule(attempt);
        else setError(failure);
      }
    }, POLL_MS);
  };

  const start = async (values: any, deferPolling = false) => {
    cancel();
    const attempt = run.current;
    request.current = values;
    deadline.current = Date.now() + WINDOW_MS;
    try {
      const data = await registerRef
        .current({
          ...values,
          body: { ...values.body, enable: true },
        })
        .unwrap();
      if (attempt !== run.current) return null;
      const result = accept(data);
      // Start the local upper bound after acknowledgement, so network/reset
      // latency cannot make us time out before IoT's own activation window.
      deadline.current = Date.now() + WINDOW_MS;
      setTime(300);
      if (
        !deferPolling &&
        ["pending", "device_confirmed"].includes(result.activation_status)
      ) {
        schedule(attempt);
      }
      return result;
    } catch (failure) {
      if (attempt === run.current) setError(failure);
      return null;
    }
  };

  return {
    response,
    error,
    time,
    start,
    cancel,
    resume: () => schedule(run.current),
  };
}
