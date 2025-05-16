export const metaToTailwind = (meta: string | undefined, base: string) => {
  base = base + " ";
  switch (meta) {
    case "ready":
      return (
        base +
        `cursor-pointer after:content-['Click_to_start!']
        hover:bg-green-50 
        `
      );
    case "speaking":
      return (
        base +
        `cursor-pointer after:content-['Speaking...']
        hover:bg-green-50
        animate-speaking`
      );
    case "recognising":
      return (
        base +
        `cursor-pointer after:content-['Listening...']
        hover:bg-green-50
        animate-recognising`
      );
    case "speaking-paused":
      return (
        base +
        `cursor-pointer after:content-['Click_to_continue!']
        hover:bg-green-50
        `
      );
    case "recognising-paused":
      return (
        base +
        `cursor-pointer after:content-['Click_to_continue!']
        hover:bg-green-50
        `
      );
    case "prepare":
      return base + `cursor-not-allowed after:content-['Please_wait...']`;
    default:
      return base + `cursor-not-allowed after:content-['...']`;
  }
};
