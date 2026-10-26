import { Link } from 'react-router-dom';
import { userData } from '../data';
import { Button, Card, CardBody, CardHeader, CardTitle } from 'react-bootstrap';

const Users = () => {
  return (
    <Card>
      <CardHeader className="d-flex justify-content-between align-items-center">
        <CardTitle>New Users</CardTitle>
        <Button variant="light" size="sm">
          View All
        </Button>
      </CardHeader>
      <CardBody className="pb-1">
        <div className="table-responsive">
          <table className="table table-hover mb-0 table-centered">
            <thead>
              <tr>
                <th className="py-1">ID</th>
                <th className="py-1">Date</th>
                <th className="py-1">User</th>
                <th className="py-1">Status</th>
                <th className="py-1">Role</th>
              </tr>
            </thead>
            <tbody>
              {userData.map((user, idx) => (
                <tr key={idx}>
                  <td>{user.id}</td>
                  <td>{user.date}</td>

                  <td>
                    <Link
                      to="/pages/profile"
                      className="d-flex align-items-center"
                    >
                      <img
                        src={user.user.avatar}
                        alt="avatar"
                        className="img-fluid avatar-xs rounded-circle"
                      />
                      <span className="align-middle ms-1">
                        {user.user.name}
                      </span>
                    </Link>
                  </td>

                  <td>
                    <span
                      className={`badge badge-soft-${
                        user.status === 'Blocked'
                          ? 'danger'
                          : user.status === 'Pending'
                          ? 'warning'
                          : 'success'
                      }`}
                    >
                      {user.status}
                    </span>
                  </td>

                  <td>{user.username}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
};

export default Users;
