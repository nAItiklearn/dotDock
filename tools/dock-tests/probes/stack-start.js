// Times each press on the dock to the first frame in which a popover (stack, tile) is open.
(() => {
  const samples = [];
  addEventListener("pointerdown", (event) => {
    const from = event.timeStamp;
    const look = (now) => {
      if (document.querySelector('.popover[data-open="true"], [role="dialog"][data-open="true"]')) samples.push(+(now - from).toFixed(2));
      else if (now - from < 1000) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, { capture: true });
  window.__dockStack = samples;
  return "armed";
})();
