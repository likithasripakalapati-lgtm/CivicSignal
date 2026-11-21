export function validateRequest(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: result.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
        },
      });
    }
    req.validated = { ...req.validated, [source]: result.data };
    return next();
  };
}
