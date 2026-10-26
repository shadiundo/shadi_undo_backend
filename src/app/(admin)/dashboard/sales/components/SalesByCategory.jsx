import IconifyIcon from '@/components/wrappers/IconifyIcon';
import ReactApexChart from 'react-apexcharts';
import { Card, CardBody, CardHeader, CardTitle, Dropdown, DropdownItem, DropdownMenu, DropdownToggle, Table } from 'react-bootstrap';
const SalesByCategory = () => {
  const chartOptions = {
    chart: {
      height: 250,
      type: 'donut'
    },
    legend: {
      show: false,
      position: 'bottom',
      horizontalAlign: 'center',
      offsetX: 0,
      offsetY: -5,
      markers: {
        width: 9,
        height: 9,
        radius: 6
      },
      itemMargin: {
        horizontal: 10,
        vertical: 0
      }
    },
    stroke: {
      width: 0
    },
    plotOptions: {
      pie: {
        donut: {
          size: '80%',
          labels: {
            show: true,
            total: {
              showAlways: true,
              show: true
            }
          }
        }
      }
    },
    series: [140, 125, 85, 60],
    labels: ['Lawyers', 'Mediators', 'Counsellors', 'Therapists'],
    colors: ['#f9b931', '#ff86c8', '#4ecac2', '#7f56da'],
    dataLabels: {
      enabled: false
    }
  };
  return <Card>
      <CardHeader className="d-flex justify-content-between align-items-center">
        <CardTitle>Numbers of Appointment</CardTitle>
        <Dropdown>
          <DropdownToggle as={'a'} role="button" className="arrow-none card-drop">
            <IconifyIcon icon="iconamoon:menu-kebab-vertical-circle-duotone" className="fs-20 align-middle text-muted" />
          </DropdownToggle>
          <DropdownMenu className="dropdown-menu-end">
            <DropdownItem href="">Sales Report</DropdownItem>
            <DropdownItem href="">Export Report</DropdownItem>
            <DropdownItem href="">Profit</DropdownItem>
            <DropdownItem href="">Action</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </CardHeader>
      <CardBody>
        <div dir="ltr">
          <ReactApexChart height={250} options={chartOptions} series={chartOptions.series} type="donut" className="apex-charts" />
        </div>
        <div className="table-responsive mb-n1 mt-2">
          <Table borderless size="sm" className="table-nowrap table-centered mb-0">
            <thead className="bg-light bg-opacity-50 thead-sm">
              <tr>
                <th className="py-1">Category</th>
                <th className="py-1">Appointments</th>
                <th className="py-1">Perc.</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Lawyers</td>
                <td>187</td>
                <td>
                  48.63%&nbsp;
                  <span className="badge badge-soft-success ms-1">2.5% Up</span>
                </td>
              </tr>
              <tr>
                <td>Mediators</td>
                <td>126</td>
                <td>
                  36.08%&nbsp;
                  <span className="badge badge-soft-success ms-1">8.5% Up</span>
                </td>
              </tr>
              <tr>
                <td>Counsellors</td>
                <td>100</td>
                <td>
                  23.41%&nbsp;
                  <span className="badge badge-soft-danger ms-1">10.98% Down</span>
                </td>
              </tr>
              <tr>
                <td>Therapits</td>
                <td>90</td>
                <td>
                  23.41%&nbsp;
                  <span className="badge badge-soft-danger ms-1">10.98% Down</span>
                </td>
              </tr>
            </tbody>
          </Table>
        </div>
      </CardBody>
    </Card>;
};
export default SalesByCategory;