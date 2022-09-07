const express = require('express');
const cors = require('cors');
const pj = require('./../package.json');

const app = express();
app.use(cors())
const port = 3000;

app.use('/', express.static('dist'))
app.use(`/${pj.name}`, express.static(`dist/${pj.name}-${pj.version}`))


app.listen(port, () => {
  console.log(`[server]: Server is running at port ${port}`);
});
